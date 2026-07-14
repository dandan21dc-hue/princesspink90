import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

export const getAuditRetention = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("admin_activity_audit_retention")
      .select("retention_days, updated_at, updated_by")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    return data ?? { retention_days: 90, updated_at: null, updated_by: null };
  });

export const updateAuditRetention = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { retention_days: number }) =>
    z.object({ retention_days: z.number().int().min(1).max(3650) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("admin_activity_audit_retention")
      .upsert(
        {
          id: true,
          retention_days: data.retention_days,
          updated_at: new Date().toISOString(),
          updated_by: context.userId,
        },
        { onConflict: "id" },
      )
      .select("retention_days, updated_at, updated_by")
      .single();
    if (error) throw error;

    await context.supabase.from("admin_activity_audit").insert({
      actor_id: context.userId,
      action: "update_retention",
      resource: "admin_activity_audit_retention",
      metadata: { retention_days: data.retention_days },
    } as never);

    return row;
  });

export type AdminAuditEntry = {
  id: string;
  actor_id: string;
  actor_display_name: string | null;
  action: string;
  resource: string;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
};

export type ListAuditFilters = {
  action?: string;
  resource?: string;
  actor_id?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
};

export type ListAuditResult = {
  rows: AdminAuditEntry[];
  total: number;
  page: number;
  pageSize: number;
};

const listFiltersSchema = z
  .object({
    action: z.string().trim().max(120).optional(),
    resource: z.string().trim().max(120).optional(),
    actor_id: z.string().uuid().optional(),
    q: z.string().trim().max(200).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.number().int().min(1).max(10_000).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
  })
  .optional();

export const listAdminAuditEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListAuditFilters | undefined) => listFiltersSchema.parse(data))
  .handler(async ({ data, context }): Promise<ListAuditResult> => {
    await assertAdmin(context.supabase, context.userId);
    const page = data?.page ?? 1;
    const pageSize = data?.pageSize ?? 50;
    const fromIdx = (page - 1) * pageSize;
    const toIdx = fromIdx + pageSize - 1;

    let q = context.supabase
      .from("admin_activity_audit")
      .select("id, actor_id, action, resource, metadata, created_at", { count: "exact" })
      .order("created_at", { ascending: false });

    const esc = (s: string) => s.replace(/[\\%_,]/g, (m) => "\\" + m);
    if (data?.action) q = q.ilike("action", `%${esc(data.action)}%`);
    if (data?.resource) q = q.ilike("resource", `%${esc(data.resource)}%`);
    if (data?.actor_id) q = q.eq("actor_id", data.actor_id);
    if (data?.from) q = q.gte("created_at", data.from);
    if (data?.to) q = q.lte("created_at", data.to);
    if (data?.q) {
      const s = esc(data.q);
      q = q.or(`action.ilike.%${s}%,resource.ilike.%${s}%`);
    }

    const { data: rows, error, count } = await q.range(fromIdx, toIdx);
    if (error) throw error;

    const actorIds = Array.from(new Set((rows ?? []).map((r: any) => r.actor_id)));
    let names = new Map<string, string | null>();
    if (actorIds.length) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", actorIds);
      names = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));
    }
    return {
      rows: (rows ?? []).map((r: any) => ({
        id: r.id,
        actor_id: r.actor_id,
        actor_display_name: names.get(r.actor_id) ?? null,
        action: r.action,
        resource: r.resource,
        metadata: r.metadata ?? {},
        created_at: r.created_at,
      })),
      total: count ?? 0,
      page,
      pageSize,
    };
  });


export const purgeExpiredAuditEntries = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("purge_expired_admin_activity_audit");
    if (error) throw error;
    await context.supabase.from("admin_activity_audit").insert({
      actor_id: context.userId,
      action: "manual_purge",
      resource: "admin_activity_audit",
      metadata: { purged: data ?? 0 },
    } as never);
    return { purged: (data as number | null) ?? 0 };
  });

export type PurgeStatus = {
  last_run_at: string | null;
  last_success_at: string | null;
  last_purged_count: number | null;
  last_status: "never" | "success" | "error";
  last_error: string | null;
};

export const getPurgeStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PurgeStatus> => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("admin_activity_audit_purge_status")
      .select("last_run_at, last_success_at, last_purged_count, last_status, last_error")
      .eq("id", true)
      .maybeSingle();
    if (error) throw error;
    return (
      (data as PurgeStatus | null) ?? {
        last_run_at: null,
        last_success_at: null,
        last_purged_count: null,
        last_status: "never",
        last_error: null,
      }
    );
  });


export type AuditIntegrityResult = {
  checked_at: string;
  total: number;
  tampered_seqs: number[];
  chain_break_seqs: number[];
  missing_seqs: number[];
  ok: boolean;
};

export type AuditAlert = {
  id: string;
  detected_at: string;
  severity: "info" | "warning" | "critical";
  kind: string;
  detail: Record<string, string | number | boolean | null>;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
};

export const verifyAuditIntegrity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AuditIntegrityResult> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc(
      "verify_admin_activity_audit_integrity" as never,
    );
    if (error) throw error;
    const result = data as unknown as AuditIntegrityResult;
    await context.supabase.from("admin_activity_audit").insert({
      actor_id: context.userId,
      action: "verify_integrity",
      resource: "admin_activity_audit",
      metadata: { ok: result?.ok ?? false, total: result?.total ?? 0 },
    } as never);
    return result;
  });

export const listAuditAlerts = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AuditAlert[]> => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("admin_activity_audit_alerts")
      .select("id, detected_at, severity, kind, detail, acknowledged_at, acknowledged_by")
      .order("detected_at", { ascending: false })
      .limit(100);
    if (error) throw error;
    return (data ?? []) as unknown as AuditAlert[];
  });

export const acknowledgeAuditAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("admin_activity_audit_alerts")
      .update({
        acknowledged_at: new Date().toISOString(),
        acknowledged_by: context.userId,
      })
      .eq("id", data.id);
    if (error) throw error;
    await context.supabase.from("admin_activity_audit").insert({
      actor_id: context.userId,
      action: "ack_alert",
      resource: "admin_activity_audit_alerts",
      metadata: { alert_id: data.id },
    } as never);
    return { ok: true };
  });

