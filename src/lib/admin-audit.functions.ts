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

    const { data: prev } = await context.supabase
      .from("admin_activity_audit_retention")
      .select("retention_days")
      .eq("id", true)
      .maybeSingle();
    const oldDays = (prev as { retention_days: number } | null)?.retention_days ?? null;

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

    if (oldDays !== data.retention_days) {
      await context.supabase.from("admin_activity_audit").insert({
        actor_id: context.userId,
        action: "update_retention",
        resource: "admin_activity_audit_retention",
        metadata: {
          old_retention_days: oldDays,
          new_retention_days: data.retention_days,
        },
      } as never);
    }

    return row;
  });

export type AuditTrustState = "trusted" | "untrusted" | "quarantined";

export type AdminAuditEntry = {
  id: string;
  seq: number;
  actor_id: string;
  actor_display_name: string | null;
  action: string;
  resource: string;
  metadata: Record<string, string | number | boolean | null>;
  created_at: string;
  trust: AuditTrustState;
  quarantine_reason: string | null;
};

export type AuditSortColumn = "created_at" | "action" | "resource" | "actor_id";
export type AuditSortDir = "asc" | "desc";

export type ListAuditFilters = {
  action?: string;
  action_match?: "contains" | "exact";
  resource?: string;
  resource_match?: "contains" | "exact";
  actor_id?: string;
  actor_name?: string;
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
  sort?: AuditSortColumn;
  dir?: AuditSortDir;
  trust?: "all" | AuditTrustState;
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
    action_match: z.enum(["contains", "exact"]).optional(),
    resource: z.string().trim().max(120).optional(),
    resource_match: z.enum(["contains", "exact"]).optional(),
    actor_id: z.string().uuid().optional(),
    actor_name: z.string().trim().max(120).optional(),
    q: z.string().trim().max(200).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    page: z.number().int().min(1).max(10_000).optional(),
    pageSize: z.number().int().min(1).max(200).optional(),
    sort: z.enum(["created_at", "action", "resource", "actor_id"]).optional(),
    dir: z.enum(["asc", "desc"]).optional(),
    trust: z.enum(["all", "trusted", "untrusted", "quarantined"]).optional(),
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
    const sort = data?.sort ?? "created_at";
    const ascending = (data?.dir ?? "desc") === "asc";
    const trustFilter = data?.trust ?? "all";

    // Precompute quarantined ids + untrusted seqs so we can filter and label rows.
    const [{ data: qRows }, { data: alertRows }] = await Promise.all([
      context.supabase
        .from("admin_activity_audit_quarantine")
        .select("audit_id, reason"),
      context.supabase
        .from("admin_activity_audit_alerts")
        .select("kind, detail")
        .in("kind", ["tampered_entries", "chain_break"]),
    ]);
    const quarantineMap = new Map<string, string | null>(
      ((qRows ?? []) as Array<{ audit_id: string; reason: string | null }>).map(
        (r) => [r.audit_id, r.reason],
      ),
    );
    const untrustedSeqs = new Set<number>();
    for (const a of (alertRows ?? []) as Array<{ detail: unknown }>) {
      const detail = (a.detail ?? {}) as { seqs?: unknown };
      const seqs = Array.isArray(detail.seqs) ? detail.seqs : [];
      for (const s of seqs) {
        const n = typeof s === "number" ? s : Number(s);
        if (Number.isFinite(n)) untrustedSeqs.add(n);
      }
    }

    let q = context.supabase
      .from("admin_activity_audit")
      .select("id, seq, actor_id, action, resource, metadata, created_at", {
        count: "exact",
      })
      .order(sort, { ascending })
      .order("id", { ascending }); // stable tiebreaker

    const esc = (s: string) => s.replace(/[\\%_,]/g, (m) => "\\" + m);
    if (data?.action) {
      if (data.action_match === "exact") q = q.eq("action", data.action);
      else q = q.ilike("action", `%${esc(data.action)}%`);
    }
    if (data?.resource) {
      if (data.resource_match === "exact") q = q.eq("resource", data.resource);
      else q = q.ilike("resource", `%${esc(data.resource)}%`);
    }
    if (data?.actor_id) q = q.eq("actor_id", data.actor_id);
    if (data?.actor_name) {
      const { data: matches } = await context.supabase
        .from("profiles")
        .select("user_id")
        .ilike("display_name", `%${esc(data.actor_name)}%`)
        .limit(500);
      const ids = ((matches ?? []) as Array<{ user_id: string }>).map((m) => m.user_id);
      if (ids.length === 0) {
        return { rows: [], total: 0, page, pageSize };
      }
      q = q.in("actor_id", ids);
    }
    if (data?.from) q = q.gte("created_at", data.from);
    if (data?.to) q = q.lte("created_at", data.to);
    if (data?.q) {
      const s = esc(data.q);
      q = q.or(`action.ilike.%${s}%,resource.ilike.%${s}%`);
    }

    if (trustFilter === "quarantined") {
      const ids = Array.from(quarantineMap.keys());
      if (ids.length === 0) return { rows: [], total: 0, page, pageSize };
      q = q.in("id", ids);
    } else if (trustFilter === "untrusted") {
      const seqs = Array.from(untrustedSeqs);
      if (seqs.length === 0) return { rows: [], total: 0, page, pageSize };
      q = q.in("seq", seqs);
    } else if (trustFilter === "trusted") {
      const ids = Array.from(quarantineMap.keys());
      const seqs = Array.from(untrustedSeqs);
      if (ids.length > 0) {
        q = q.not("id", "in", `(${ids.map((i) => `"${i}"`).join(",")})`);
      }
      if (seqs.length > 0) {
        q = q.not("seq", "in", `(${seqs.join(",")})`);
      }
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
    const trustFor = (id: string, seq: number): AuditTrustState => {
      if (quarantineMap.has(id)) return "quarantined";
      if (untrustedSeqs.has(seq)) return "untrusted";
      return "trusted";
    };
    return {
      rows: (rows ?? []).map((r: any) => ({
        id: r.id,
        seq: r.seq,
        actor_id: r.actor_id,
        actor_display_name: names.get(r.actor_id) ?? null,
        action: r.action,
        resource: r.resource,
        metadata: r.metadata ?? {},
        created_at: r.created_at,
        trust: trustFor(r.id, r.seq),
        quarantine_reason: quarantineMap.get(r.id) ?? null,
      })),
      total: count ?? 0,
      page,
      pageSize,
    };
  });

export const setAuditEntryQuarantine = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; quarantined: boolean; reason?: string }) =>
    z
      .object({
        id: z.string().uuid(),
        quarantined: z.boolean(),
        reason: z.string().trim().max(500).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.quarantined) {
      const { error } = await context.supabase
        .from("admin_activity_audit_quarantine")
        .upsert(
          {
            audit_id: data.id,
            quarantined_by: context.userId,
            quarantined_at: new Date().toISOString(),
            reason: data.reason ?? null,
          },
          { onConflict: "audit_id" },
        );
      if (error) throw error;
    } else {
      const { error } = await context.supabase
        .from("admin_activity_audit_quarantine")
        .delete()
        .eq("audit_id", data.id);
      if (error) throw error;
    }
    await context.supabase.from("admin_activity_audit").insert({
      actor_id: context.userId,
      action: data.quarantined ? "quarantine_entry" : "release_quarantine",
      resource: "admin_activity_audit",
      metadata: { audit_id: data.id, reason: data.reason ?? null },
    } as never);
    return { ok: true, quarantined: data.quarantined };
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

