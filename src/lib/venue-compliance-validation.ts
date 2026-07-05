// Shared validation rules for venue compliance uploads.
// Imported by both the client form and the server function so that
// the client blocks bad files early and the server enforces the same
// rules regardless of what the client sends.

export const VENUE_COMPLIANCE_MAX_BYTES = 15 * 1024 * 1024; // 15 MB

export const VENUE_COMPLIANCE_ALLOWED_MIME = [
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const VENUE_COMPLIANCE_ALLOWED_EXT = [
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "webp",
] as const;

export const VENUE_COMPLIANCE_ACCEPT_ATTR =
  ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

export const VENUE_COMPLIANCE_FILE_HELP =
  "PDF, PNG, JPG, or WEBP · up to 15 MB";

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export type FileValidationInput = {
  name: string;
  size: number;
  type?: string | null;
};

export function validateComplianceFile(
  file: FileValidationInput,
): { ok: true } | { ok: false; error: string } {
  if (!file.name || !file.name.trim()) {
    return { ok: false, error: "File is missing a name." };
  }
  if (file.size <= 0) {
    return { ok: false, error: "The selected file is empty." };
  }
  if (file.size > VENUE_COMPLIANCE_MAX_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return {
      ok: false,
      error: `File is ${mb} MB. The 15 MB limit was exceeded — please upload a smaller PDF or image.`,
    };
  }
  const ext = extOf(file.name);
  const extOk = (VENUE_COMPLIANCE_ALLOWED_EXT as readonly string[]).includes(
    ext,
  );
  const mime = (file.type ?? "").toLowerCase();
  const mimeOk =
    !mime ||
    (VENUE_COMPLIANCE_ALLOWED_MIME as readonly string[]).includes(mime);
  if (!extOk || !mimeOk) {
    return {
      ok: false,
      error:
        "Only PDF, PNG, JPG, or WEBP files can be uploaded as compliance documents.",
    };
  }
  return { ok: true };
}

/**
 * Validate an ISO date string (YYYY-MM-DD) representing the document's
 * expiry. Returns an error string when the date is already in the past.
 */
export function validateExpiryDate(
  expires_on: string | null | undefined,
): { ok: true } | { ok: false; error: string } {
  if (!expires_on) return { ok: true };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expires_on)) {
    return { ok: false, error: "Expiry date must be a valid calendar date." };
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const exp = new Date(expires_on + "T00:00:00");
  if (Number.isNaN(exp.getTime())) {
    return { ok: false, error: "Expiry date is not a valid calendar date." };
  }
  if (exp.getTime() < today.getTime()) {
    return {
      ok: false,
      error:
        "This document is already expired. Upload a renewed certificate instead.",
    };
  }
  return { ok: true };
}
