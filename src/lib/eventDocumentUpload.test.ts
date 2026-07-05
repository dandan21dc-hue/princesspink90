import { describe, it, expect, vi } from "vitest";
import {
  uploadEventDocument,
  isMissingAgreementError,
  type SupabaseLike,
  type RegisterFn,
} from "./eventDocumentUpload";

function makeFile(name = "permit.pdf", type = "application/pdf", size = 1024): File {
  return new File([new Uint8Array(size)], name, { type });
}

function makeSupabase(overrides?: {
  uploadError?: { message: string } | null;
  removeError?: { message: string } | null;
}) {
  const upload = vi.fn(
    async (_path: string, _file: Blob | File) => ({ error: overrides?.uploadError ?? null }),
  );
  const remove = vi.fn(async (_paths: string[]) => ({ error: overrides?.removeError ?? null }));
  const supabase: SupabaseLike = {
    storage: {
      from: (bucket: string) => {
        expect(bucket).toBe("event-documents");
        return { upload, remove };
      },
    },
  };
  return { supabase, upload, remove };
}

const EVENT_ID = "11111111-1111-1111-1111-111111111111";
const VERSION_ID = "22222222-2222-2222-2222-222222222222";
const KEY = `${EVENT_ID}/permit-fixed-key-permit.pdf`;

describe("isMissingAgreementError", () => {
  it("matches the server-side agreement rejection message", () => {
    expect(
      isMissingAgreementError(
        "You must agree to compliance policy v3 before uploading documents. Check the agreement box above the upload slots and try again.",
      ),
    ).toBe(true);
  });

  it("matches the version-bump and older-agreement rejection messages (also cleaned up)", () => {
    expect(
      isMissingAgreementError(
        "Compliance policy has been updated to v4 (you submitted v3). Reload the page, review the current policy, and agree to v4 before uploading.",
      ),
    ).toBe(true);
    expect(
      isMissingAgreementError(
        "Your last agreement was to compliance policy v2, but v3 is now in effect. Review and agree to v3 before uploading documents.",
      ),
    ).toBe(true);
  });

  it("does not match unrelated errors", () => {
    expect(isMissingAgreementError("Invalid file path")).toBe(false);
    expect(isMissingAgreementError("Network error")).toBe(false);
  });
});

describe("uploadEventDocument — blocks when no agreement exists", () => {
  it("returns an error result and cleans up storage when the server rejects for missing agreement", async () => {
    const { supabase, upload, remove } = makeSupabase();
    const register: RegisterFn = vi.fn(async () => {
      throw new Error(
        "You must agree to compliance policy v2 before uploading documents. Check the agreement box above the upload slots and try again.",
      );
    });

    const result = await uploadEventDocument({
      supabase,
      register,
      eventId: EVENT_ID,
      type: "permit",
      file: makeFile(),
      currentVersionId: VERSION_ID,
      key: KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cleanedUp).toBe(true);
    expect(result.error.message).toMatch(/agree to compliance policy/i);

    // Uploaded once, then removed the same key.
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls[0][0]).toBe(KEY);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove.mock.calls[0][0]).toEqual([KEY]);
    // Register was attempted with the current policy version id.
    expect(register).toHaveBeenCalledTimes(1);
    const arg = (register as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(arg.data.policy_version_id).toBe(VERSION_ID);
    expect(arg.data.file_path).toBe(KEY);
  });

  it("does not delete the object for unrelated failures (leaves it for retry)", async () => {
    const { supabase, remove } = makeSupabase();
    const register: RegisterFn = vi.fn(async () => {
      throw new Error("Network error");
    });

    const result = await uploadEventDocument({
      supabase,
      register,
      eventId: EVENT_ID,
      type: "permit",
      file: makeFile(),
      currentVersionId: VERSION_ID,
      key: KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.cleanedUp).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("does not delete anything when the storage upload itself fails", async () => {
    const { supabase, remove } = makeSupabase({ uploadError: { message: "storage down" } });
    const register: RegisterFn = vi.fn();

    const result = await uploadEventDocument({
      supabase,
      register,
      eventId: EVENT_ID,
      type: "insurance",
      file: makeFile("ins.pdf"),
      currentVersionId: VERSION_ID,
      key: KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(register).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(result.cleanedUp).toBe(false);
  });

  it("swallows storage.remove failures so the surfaced error is the agreement one", async () => {
    const { supabase, remove } = makeSupabase({ removeError: { message: "gone" } });
    const register: RegisterFn = vi.fn(async () => {
      throw new Error("You must agree to compliance policy v1 before uploading documents.");
    });

    const result = await uploadEventDocument({
      supabase,
      register,
      eventId: EVENT_ID,
      type: "capacity",
      file: makeFile("cap.pdf"),
      currentVersionId: VERSION_ID,
      key: KEY,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toMatch(/agree to compliance policy/i);
    expect(result.cleanedUp).toBe(true);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("returns ok and does not touch remove when the server accepts the upload", async () => {
    const { supabase, upload, remove } = makeSupabase();
    const register: RegisterFn = vi.fn(async () => ({ id: "doc-1" }));

    const result = await uploadEventDocument({
      supabase,
      register,
      eventId: EVENT_ID,
      type: "permit",
      file: makeFile(),
      currentVersionId: VERSION_ID,
      key: KEY,
    });

    expect(result.ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });
});
