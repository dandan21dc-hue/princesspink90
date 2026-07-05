import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CohostApplication = {
  id: string;
  user_id: string;
  display_name: string;
  age: number;
  city: string;
  instagram_handle: string | null;
  other_socials: string | null;
  hosting_experience: string;
  why_join: string;
  bio: string | null;
  availability: string | null;
  event_types: string | null;
  status: "pending" | "approved" | "rejected" | "withdrawn";
  admin_notes: string | null;
  submitted_at: string;
  reviewed_at: string | null;
};

const applicationInput = z.object({
  display_name: z.string().trim().min(2).max(80),
  age: z.number().int().min(18).max(120),
  city: z.string().trim().min(2).max(120),
  instagram_handle: z.string().trim().max(80).optional().or(z.literal("")),
  other_socials: z.string().trim().max(500).optional().or(z.literal("")),
  bio: z.string().trim().max(600).optional().or(z.literal("")),
  hosting_experience: z.string().trim().min(10).max(2000),
  why_join: z.string().trim().min(10).max(2000),
  availability: z.string().trim().max(500).optional().or(z.literal("")),
  event_types: z.string().trim().max(500).optional().or(z.literal("")),
});

async function assertEligible(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("age_verifications")
    .select("status, selfie_file_path")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.status !== "approved") {
    throw new Error("Complete age verification (18+ approved) before applying.");
  }
  if (!data.selfie_file_path) {
    throw new Error("A selfie on file is required before applying.");
  }
}

export const getMyCohostApplication = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("cohost_applications")
      .select(
        "id, user_id, display_name, age, city, instagram_handle, other_socials, bio, hosting_experience, why_join, availability, event_types, status, admin_notes, submitted_at, reviewed_at",
      )
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as CohostApplication | null;
  });

export const getCohostEligibility = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("age_verifications")
      .select("status, selfie_file_path")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      ageVerified: data?.status === "approved",
      hasSelfie: Boolean(data?.selfie_file_path),
      status: (data?.status ?? null) as string | null,
    };
  });

export const submitCohostApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof applicationInput>) => applicationInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertEligible(context.supabase, context.userId);

    const payload = {
      user_id: context.userId,
      display_name: data.display_name,
      age: data.age,
      city: data.city,
      instagram_handle: data.instagram_handle || null,
      other_socials: data.other_socials || null,
      bio: data.bio || null,
      hosting_experience: data.hosting_experience,
      why_join: data.why_join,
      availability: data.availability || null,
      event_types: data.event_types || null,
      status: "pending" as const,
      submitted_at: new Date().toISOString(),
    };

    const { error } = await context.supabase
      .from("cohost_applications")
      .upsert(payload, { onConflict: "user_id" });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const withdrawMyCohostApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { error } = await context.supabase
      .from("cohost_applications")
      .delete()
      .eq("user_id", context.userId)
      .eq("status", "pending");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// -------- Admin --------

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const adminListCohostApplications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("cohost_applications")
      .select("*")
      .order("submitted_at", { ascending: false });
    if (error) throw new Error(error.message);

    const rows = data ?? [];
    const emails: Record<string, string | null> = {};
    for (const r of rows) {
      if (emails[r.user_id] === undefined) {
        const { data: u } = await supabaseAdmin.auth.admin.getUserById(r.user_id);
        emails[r.user_id] = u.user?.email ?? null;
      }
    }
    return rows.map((r) => ({ ...r, email: emails[r.user_id] ?? null }));
  });

export const adminReviewCohostApplication = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; decision: "approved" | "rejected"; notes?: string }) =>
    z.object({
      id: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
      notes: z.string().max(2000).optional(),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: app, error: findErr } = await supabaseAdmin
      .from("cohost_applications")
      .select("id, user_id, status")
      .eq("id", data.id)
      .maybeSingle();
    if (findErr) throw new Error(findErr.message);
    if (!app) throw new Error("Not found.");

    const { error: updErr } = await supabaseAdmin
      .from("cohost_applications")
      .update({
        status: data.decision,
        admin_notes: data.notes ?? null,
        reviewed_at: new Date().toISOString(),
        reviewed_by: context.userId,
      })
      .eq("id", data.id);
    if (updErr) throw new Error(updErr.message);

    if (data.decision === "approved") {
      // Grant cohost role (idempotent via unique constraint)
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: app.user_id, role: "cohost" as any });
      if (roleErr && !/duplicate|unique/i.test(roleErr.message)) {
        throw new Error(roleErr.message);
      }
    }
    return { ok: true };
  });
