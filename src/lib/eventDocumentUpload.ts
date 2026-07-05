// Pure helper that encapsulates the "upload file to storage, then register it
// with the server" flow used by EventDocumentsSection. Extracted so it can be
// exercised by integration tests without rendering the component.
//
// Contract:
//  - Uploads the file to the `event-documents` storage bucket.
//  - Calls `register` (the registerEventDocument server fn) with the new key.
//  - If the server rejects because there is no current-policy agreement on
//    file, the storage object is removed so we do not leak orphaned uploads.
//  - Any other failure is surfaced to the caller; storage is NOT cleaned up
//    for those (they may be transient and the object can be reused on retry).

export type DocType = "permit" | "insurance" | "capacity" | "other";

export interface StorageLike {
  from(bucket: string): {
    upload(
      path: string,
      file: Blob | File,
      opts?: { contentType?: string; upsert?: boolean },
    ): Promise<{ error: { message: string } | null }>;
    remove(paths: string[]): Promise<{ error: { message: string } | null }>;
  };
}

export interface SupabaseLike {
  storage: StorageLike;
}

export interface RegisterInput {
  event_id: string;
  doc_type: DocType;
  file_path: string;
  file_name: string;
  content_type?: string;
  size_bytes?: number;
  policy_version_id: string;
}

export type RegisterFn = (args: { data: RegisterInput }) => Promise<unknown>;

export interface UploadArgs {
  supabase: SupabaseLike;
  register: RegisterFn;
  eventId: string;
  type: DocType;
  file: File;
  currentVersionId: string;
  key?: string; // override for deterministic tests
}

export type UploadResult =
  | { ok: true; key: string }
  | { ok: false; key: string; error: Error; cleanedUp: boolean };

const AGREEMENT_ERROR_RE = /agree to (?:compliance policy|v\d)|compliance policy has been updated|last agreement was to compliance policy/i;

export function isMissingAgreementError(message: string): boolean {
  return AGREEMENT_ERROR_RE.test(message);
}

export function buildStorageKey(eventId: string, type: DocType, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
  return `${eventId}/${type}-${crypto.randomUUID()}-${safeName}`;
}

export async function uploadEventDocument(args: UploadArgs): Promise<UploadResult> {
  const key = args.key ?? buildStorageKey(args.eventId, args.type, args.file.name);
  let uploaded = false;
  try {
    const { error: upErr } = await args.supabase.storage
      .from("event-documents")
      .upload(key, args.file, {
        contentType: args.file.type || undefined,
        upsert: false,
      });
    if (upErr) throw new Error(upErr.message);
    uploaded = true;
    await args.register({
      data: {
        event_id: args.eventId,
        doc_type: args.type,
        file_path: key,
        file_name: args.file.name.slice(0, 200),
        content_type: args.file.type || undefined,
        size_bytes: args.file.size,
        policy_version_id: args.currentVersionId,
      },
    });
    return { ok: true, key };
  } catch (e) {
    const err = e instanceof Error ? e : new Error("Upload failed");
    let cleanedUp = false;
    if (uploaded && isMissingAgreementError(err.message)) {
      await args.supabase.storage
        .from("event-documents")
        .remove([key])
        .catch(() => {});
      cleanedUp = true;
    }
    return { ok: false, key, error: err, cleanedUp };
  }
}
