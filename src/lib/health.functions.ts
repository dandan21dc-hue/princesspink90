import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/** How long a screening stays valid after the test date (days). */
export const SCREENING_VALIDITY_DAYS = 90;

export type HealthScreening = {
  id: string;
  file_path: string;
  test_date: string;
  status: "pending" | "approved" | "rejected";
  valid_until: string | null;
  notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

/** Guest: list all of their own screenings, newest first. */
export const listMyHealthScreenings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("health_screenings")
      .select("id, file_path, test_date, status, valid_until, notes, submitted_at, reviewed_at")
      .eq("user_id", context.userId)
      .order("submitted_at", { ascending: false });
    if (error) throw error;
    return (data ?? []) as HealthScreening[];
  });

/** Guest: submit a new screening record. File must already be uploaded to storage. */
export const submitHealthScreening = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { test_date: string; file_path: string }) =>
    z.object({
      test_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid test date"),
      file_path: z.string().min(1).max(500),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const today = new Date();
    const test = new Date(data.test_date);
    if (Number.isNaN(test.getTime())) throw new Error("Invalid test date.");
    if (test > today) throw new Error("Test date can't be in the future.");
    const ninetyAgo = new Date();
    ninetyAgo.setDate(ninetyAgo.getDate() - SCREENING_VALIDITY_DAYS);
    if (test < ninetyAgo) {
      throw new Error(`Test must be within the last ${SCREENING_VALIDITY_DAYS} days.`);
    }
    const validUntil = new Date(test);
    validUntil.setDate(validUntil.getDate() + SCREENING_VALIDITY_DAYS);

    const { error } = await context.supabase.from("health_screenings").insert({
      user_id: context.userId,
      file_path: data.file_path,
      test_date: data.test_date,
      status: "pending",
      valid_until: validUntil.toISOString().slice(0, 10),
    });
    if (error) throw error;
    return { ok: true };
  });

/** Guest: delete a pending screening they haven't been reviewed yet. */
export const deleteMyPendingScreening = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    // Fetch the row to grab file_path AND confirm it's pending & owned.
    const { data: row, error: findErr } = await context.supabase
      .from("health_screenings")
      .select("id, file_path, status, user_id")
      .eq("id", data.id)
      .maybeSingle();
    if (findErr) throw findErr;
    if (!row) throw new Error("Not found.");
    if (row.user_id !== context.userId) throw new Error("Not yours.");
    if (row.status !== "pending") throw new Error("Only pending uploads can be removed.");

    await context.supabase.storage.from("health-screenings").remove([row.file_path]);
    const { error } = await context.supabase.from("health_screenings").delete().eq("id", row.id);
    if (error) throw error;
    return { ok: true };
  });

/** Guest: signed URL to view their own screening file. */
export const getMyScreeningSignedUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { path: string }) =>
    z.object({ path: z.string().min(1).max(500) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    if (!data.path.startsWith(`${context.userId}/`)) throw new Error("Not yours.");
    const { data: signed, error } = await context.supabase.storage
      .from("health-screenings")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw error;
    return { url: signed.signedUrl };
  });

/** Admin: list every screening for review, newest first. */
export const adminListHealthScreenings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("health_screenings")
      .select(
        "id, user_id, file_path, test_date, status, valid_until, notes, submitted_at, reviewed_at",
      )
      .order("submitted_at", { ascending: false });
    if (error) throw error;

    const rows = data ?? [];
    if (rows.length === 0) return [];

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return await Promise.all(
      rows.map(async (r) => {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        return { ...r, email: u?.user?.email ?? null };
      }),
    );
  });

/** Admin: signed URL for a screening file. */
export const adminGetScreeningSignedUrl = createServerFn({ method: "POST" })
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
      .from("health-screenings")
      .createSignedUrl(data.path, 60 * 10);
    if (error) throw error;
    return { url: signed.signedUrl };
  });

/** Admin: approve or reject a screening. */
export const adminReviewHealthScreening = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      id: string;
      status: "approved" | "rejected";
      notes?: string;
      valid_until?: string;
    }) =>
      z.object({
        id: z.string().uuid(),
        status: z.enum(["approved", "rejected"]),
        notes: z.string().max(1000).optional(),
        valid_until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date").optional(),
      }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const patch: {
      status: "approved" | "rejected";
      notes: string | null;
      reviewed_at: string;
      reviewed_by: string;
      valid_until?: string;
    } = {
      status: data.status,
      notes: data.notes ?? null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: context.userId,
    };
    if (data.valid_until) patch.valid_until = data.valid_until;

    const { error } = await context.supabase
      .from("health_screenings")
      .update(patch)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });


/** True if the user has any currently-valid approved screening. */
export function isScreeningCurrent(rows: HealthScreening[]): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return rows.some(
    (r) => r.status === "approved" && r.valid_until !== null && r.valid_until >= today,
  );
}
