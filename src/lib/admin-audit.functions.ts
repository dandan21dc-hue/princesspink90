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
    });

    return row;
  });

export type AdminAuditEntry = {
  id: string;
  actor_id: string;
  actor_display_name: string | null;
  action: string;
  resource: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export const listAdminAuditEntries = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number } | undefined) =>
    z.object({ limit: z.number().int().min(1).max(500).optional() }).optional().parse(data),
  )
  .handler(async ({ data, context }): Promise<AdminAuditEntry[]> => {
    await assertAdmin(context.supabase, context.userId);
    const limit = data?.limit ?? 200;
    const { data: rows, error } = await context.supabase
      .from("admin_activity_audit")
      .select("id, actor_id, action, resource, metadata, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
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
    return (rows ?? []).map((r: any) => ({
      id: r.id,
      actor_id: r.actor_id,
      actor_display_name: names.get(r.actor_id) ?? null,
      action: r.action,
      resource: r.resource,
      metadata: r.metadata ?? {},
      created_at: r.created_at,
    }));
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
    });
    return { purged: (data as number | null) ?? 0 };
  });
