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

export type ComplianceAuditEntry = {
  kind: "agreement" | "document";
  id: string;
  at: string;
  user_id: string;
  user_display_name: string | null;
  policy_version_id: string | null;
  policy_version_label: string | null;
  event_id: string | null;
  event_title: string | null;
  // agreement-only
  ip_address?: string | null;
  user_agent?: string | null;
  // document-only
  doc_type?: string | null;
  file_name?: string | null;
};

export const listComplianceAuditLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { policy_version_id?: string | null; limit?: number }) =>
    z.object({
      policy_version_id: z.string().uuid().optional().nullable(),
      limit: z.number().int().min(1).max(500).optional(),
    }).parse(data ?? {}),
  )
  .handler(async ({ data, context }): Promise<ComplianceAuditEntry[]> => {
    await assertAdmin(context.supabase, context.userId);
    const limit = data.limit ?? 200;

    let agQ = context.supabase
      .from("compliance_policy_agreements")
      .select("id, accepted_by_user_id, policy_version_id, policy_version_label, event_id, accepted_at, ip_address, user_agent")
      .order("accepted_at", { ascending: false })
      .limit(limit);
    if (data.policy_version_id) agQ = agQ.eq("policy_version_id", data.policy_version_id);
    const { data: agreements, error: agErr } = await agQ;
    if (agErr) throw agErr;

    let docQ = context.supabase
      .from("event_documents")
      .select("id, uploaded_by, policy_version_id, policy_version_label, event_id, uploaded_at, doc_type, file_name")
      .order("uploaded_at", { ascending: false })
      .limit(limit);
    if (data.policy_version_id) docQ = docQ.eq("policy_version_id", data.policy_version_id);
    const { data: documents, error: docErr } = await docQ;
    if (docErr) throw docErr;

    const userIds = Array.from(new Set<string>([
      ...(agreements ?? []).map((r: any) => r.accepted_by_user_id),
      ...(documents ?? []).map((r: any) => r.uploaded_by),
    ].filter(Boolean)));
    const eventIds = Array.from(new Set<string>([
      ...(agreements ?? []).map((r: any) => r.event_id),
      ...(documents ?? []).map((r: any) => r.event_id),
    ].filter(Boolean)));

    const [profilesRes, eventsRes] = await Promise.all([
      userIds.length
        ? context.supabase.from("profiles").select("user_id, display_name").in("user_id", userIds)
        : Promise.resolve({ data: [], error: null }),
      eventIds.length
        ? context.supabase.from("events").select("id, title").in("id", eventIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (profilesRes.error) throw profilesRes.error;
    if (eventsRes.error) throw eventsRes.error;

    const nameByUser = new Map<string, string>();
    for (const p of (profilesRes.data ?? []) as any[]) nameByUser.set(p.user_id, p.display_name);
    const titleByEvent = new Map<string, string>();
    for (const e of (eventsRes.data ?? []) as any[]) titleByEvent.set(e.id, e.title);

    const entries: ComplianceAuditEntry[] = [
      ...(agreements ?? []).map((r: any): ComplianceAuditEntry => ({
        kind: "agreement",
        id: r.id,
        at: r.accepted_at,
        user_id: r.accepted_by_user_id,
        user_display_name: nameByUser.get(r.accepted_by_user_id) ?? null,
        policy_version_id: r.policy_version_id,
        policy_version_label: r.policy_version_label,
        event_id: r.event_id,
        event_title: r.event_id ? titleByEvent.get(r.event_id) ?? null : null,
        ip_address: r.ip_address,
        user_agent: r.user_agent,
      })),
      ...(documents ?? []).map((r: any): ComplianceAuditEntry => ({
        kind: "document",
        id: r.id,
        at: r.uploaded_at,
        user_id: r.uploaded_by,
        user_display_name: nameByUser.get(r.uploaded_by) ?? null,
        policy_version_id: r.policy_version_id,
        policy_version_label: r.policy_version_label,
        event_id: r.event_id,
        event_title: r.event_id ? titleByEvent.get(r.event_id) ?? null : null,
        doc_type: r.doc_type,
        file_name: r.file_name,
      })),
    ];

    entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return entries.slice(0, limit);
  });

