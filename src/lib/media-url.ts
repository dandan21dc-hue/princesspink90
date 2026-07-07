import { supabase } from "@/integrations/supabase/client";

/**
 * Turn whatever we have stored on a listing row into a usable <img|video src>.
 *
 * Handles three storage shapes we see in the wild:
 *  - Already an absolute URL (http/https) — signed URL from admin upload, or
 *    a user-pasted URL. Returned unchanged.
 *  - A protocol-relative or root-relative URL (//..., /...) — returned as-is.
 *  - A bare bucket path like "user-id/panty-listings/abc.jpg" — resolved
 *    against Supabase Storage's public URL for the given bucket.
 *
 * If the bucket is private the public URL will 403; combine with `onImgError`
 * so the UI falls back to a placeholder instead of a broken-image icon.
 */
export function resolveMediaUrl(
  value: string | null | undefined,
  bucket = "content-media",
): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^(https?:)?\/\//i.test(trimmed) || trimmed.startsWith("/")) return trimmed;
  const { data } = supabase.storage.from(bucket).getPublicUrl(trimmed);
  return data?.publicUrl ?? null;
}

/**
 * 1x1 transparent + soft "no image" tile used as an <img> fallback. Inline
 * so it never itself 404s. Callers can override via `onImgError({ fallback })`.
 */
export const MEDIA_PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5" preserveAspectRatio="xMidYMid slice">
       <rect width="4" height="5" fill="#1f1720"/>
       <text x="2" y="2.7" text-anchor="middle" font-family="system-ui,sans-serif"
             font-size="0.5" fill="#8a7a86">image unavailable</text>
     </svg>`,
  );

/**
 * Attach as `onError={onImgError}` to any <img>. Swaps in the placeholder
 * exactly once (guards against infinite re-error loops).
 */
export function onImgError(
  e: React.SyntheticEvent<HTMLImageElement>,
  fallback: string = MEDIA_PLACEHOLDER,
) {
  const img = e.currentTarget;
  if (img.dataset.fallbackApplied === "1") return;
  img.dataset.fallbackApplied = "1";
  img.src = fallback;
}
