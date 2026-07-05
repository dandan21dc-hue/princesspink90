import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

export const updateCurrentPolicy = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { summary: string; body: string }) =>
    z.object({
      summary: z.string().trim().min(10).max(500),
      body: z.string().trim().min(20).max(20000),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: current, error: readErr } = await context.supabase
      .from("compliance_policy_versions")
      .select("id")
      .eq("is_current", true)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!current) throw new Error("No current policy version exists");
    const { data: row, error } = await context.supabase
      .from("compliance_policy_versions")
      .update({ summary: data.summary, body: data.body })
      .eq("id", current.id)
      .select("id, version, effective_at, summary, body, is_current")
      .single();
    if (error) throw error;
    return row;
  });

export const publishNewPolicyVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { version: string; summary: string; body: string }) =>
    z.object({
      version: z.string().trim().min(1).max(40).regex(/^[0-9A-Za-z.\-_]+$/, "Version can only contain letters, numbers, dot, dash, underscore"),
      summary: z.string().trim().min(10).max(500),
      body: z.string().trim().min(20).max(20000),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    // Ensure this version label isn't already used.
    const { data: existing, error: exErr } = await context.supabase
      .from("compliance_policy_versions")
      .select("id")
      .eq("version", data.version)
      .maybeSingle();
    if (exErr) throw exErr;
    if (existing) throw new Error(`Version ${data.version} already exists`);

    // Unset previous current, then insert new current. The partial unique index
    // permits at most one row with is_current = true at a time.
    const { error: unsetErr } = await context.supabase
      .from("compliance_policy_versions")
      .update({ is_current: false })
      .eq("is_current", true);
    if (unsetErr) throw unsetErr;

    const { data: row, error } = await context.supabase
      .from("compliance_policy_versions")
      .insert({
        version: data.version,
        summary: data.summary,
        body: data.body,
        is_current: true,
        created_by: context.userId,
      })
      .select("id, version, effective_at, summary, body, is_current")
      .single();
    if (error) {
      // Best-effort rollback: restore previous current if insert failed.
      await context.supabase
        .from("compliance_policy_versions")
        .update({ is_current: true })
        .eq("version", data.version === "" ? "__none__" : data.version);
      throw error;
    }
    return row;
  });

export const getPolicyVersionAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("compliance_policy_versions")
      .select("id, version, effective_at, summary, body, is_current, created_at, updated_at")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Not found");
    return row;
  });
