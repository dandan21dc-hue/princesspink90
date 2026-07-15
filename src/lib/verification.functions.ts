import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type VideoConsent = {
  private_archive: boolean;
  public_promo: boolean;
  face_blurred_only: boolean;
  no_filming: boolean;
};

export const videoConsentSchema = z.object({
  private_archive: z.boolean(),
  public_promo: z.boolean(),
  face_blurred_only: z.boolean(),
  no_filming: z.boolean(),
});

/** Current wording version of the adult-content release. Bump when copy changes. */
export const ADULT_CONTENT_RELEASE_VERSION = "draft-2026-07-05";

/** Fetch current user's age-verification record (if any). */
export const getMyAgeVerification = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("age_verifications")
      .select(
        "id, date_of_birth, status, submitted_at, reviewed_at, notes, id_file_path, selfie_file_path, adult_content_release, adult_content_release_at, adult_content_release_version",
      )
      .eq("user_id", context.userId)
      .maybeSingle();
    return data;
  });

/** Submit or replace the guest's pending age-verification record. */
export const submitAgeVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      date_of_birth: string;
      id_file_path: string;
      selfie_file_path: string;
      adult_content_release: boolean;
      adult_content_release_version?: string;
    }) =>
      z.object({
        date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date"),
        id_file_path: z.string().min(1).max(500),
        selfie_file_path: z.string().min(1).max(500),
        adult_content_release: z.boolean(),
        adult_content_release_version: z.string().max(100).optional(),
      }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Server-side 18+ check
    const dob = new Date(data.date_of_birth);
    const cutoff = new Date();
    cutoff.setFullYear(cutoff.getFullYear() - 18);
    if (dob > cutoff) throw new Error("You must be 18 or older.");

    const releaseFields = data.adult_content_release
      ? {
          adult_content_release: true,
          adult_content_release_at: new Date().toISOString(),
          adult_content_release_version:
            data.adult_content_release_version ?? ADULT_CONTENT_RELEASE_VERSION,
        }
      : {
          adult_content_release: false,
          adult_content_release_at: null,
          adult_content_release_version: null,
        };

    const { data: existing } = await context.supabase
      .from("age_verifications")
      .select("id, status")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (existing && existing.status === "approved") {
      // Approved users can still update ONLY their adult-content release toggle
      // (they may revoke or grant it later) without re-triggering review.
      const { error } = await context.supabase
        .from("age_verifications")
        .update(releaseFields)
        .eq("id", existing.id);
      if (error) throw error;
      return { ok: true, release_only: true as const };
    }

    if (existing) {
      const { error } = await context.supabase
        .from("age_verifications")
        .update({
          date_of_birth: data.date_of_birth,
          id_file_path: data.id_file_path,
          selfie_file_path: data.selfie_file_path,
          status: "pending",
          submitted_at: new Date().toISOString(),
          reviewed_at: null,
          reviewed_by: null,
          notes: null,
          ...releaseFields,
        })
        .eq("id", existing.id);
      if (error) throw error;
    } else {
      const { error } = await context.supabase.from("age_verifications").insert({
        user_id: context.userId,
        date_of_birth: data.date_of_birth,
        id_file_path: data.id_file_path,
        selfie_file_path: data.selfie_file_path,
        status: "pending",
        ...releaseFields,
      });
      if (error) throw error;
    }
    return { ok: true };
  });

/** Update ONLY the adult-content release toggle for an already-approved guest. */
export const updateAdultContentRelease = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { agreed: boolean; version?: string }) =>
    z.object({ agreed: z.boolean(), version: z.string().max(100).optional() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const patch = data.agreed
      ? {
          adult_content_release: true,
          adult_content_release_at: new Date().toISOString(),
          adult_content_release_version: data.version ?? ADULT_CONTENT_RELEASE_VERSION,
        }
      : {
          adult_content_release: false,
          adult_content_release_at: null,
          adult_content_release_version: null,
        };
    const { error } = await context.supabase
      .from("age_verifications")
      .update(patch)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

/**
 * Derived verification status for the current user, used to show a shortcut
 * card on the profile. Extends the existing age_verifications pipeline —
 * no new column, no parallel table.
 */
export const getMyVerificationStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("age_verifications")
      .select("status, submitted_at, reviewed_at, notes")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      status: (data?.status ?? "unsubmitted") as
        | "unsubmitted"
        | "pending"
        | "approved"
        | "rejected",
      submitted_at: data?.submitted_at ?? null,
      reviewed_at: data?.reviewed_at ?? null,
      notes: data?.notes ?? null,
    };
  });

/** Admin: count of verifications waiting for review. */
export const adminCountPendingAgeVerifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { count, error } = await context.supabase
      .from("age_verifications")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw error;
    return { pending: count ?? 0 };
  });




/** Admin: list all verifications. */
export const adminListAgeVerifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("age_verifications")
      .select("id, user_id, date_of_birth, status, submitted_at, reviewed_at, id_file_path, notes")
      .order("submitted_at", { ascending: false });
    if (error) throw error;

    const rows = data ?? [];
    if (rows.length === 0) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const withEmails = await Promise.all(
      rows.map(async (r) => {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        return { ...r, email: u?.user?.email ?? null };
      }),
    );
    return withEmails;
  });

/** Admin: create a signed URL to review a submitted ID. */
export const adminGetIdSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) =>
    z.object({ path: z.string().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("id-verifications")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw error;
    return { url: signed.signedUrl };
  });

/** Admin: approve or reject a verification. */
export const adminReviewAgeVerification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; status: "approved" | "rejected"; notes?: string }) =>
    z.object({
      id: z.string().uuid(),
      status: z.enum(["approved", "rejected"]),
      notes: z.string().max(1000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { error } = await context.supabase
      .from("age_verifications")
      .update({
        status: data.status,
        notes: data.notes ?? null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: context.userId,
      })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
