import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

const filterSchema = z.object({
  reason: z.enum(["all", "expired_validity", "rejected_retention_expired", "pending_stale"]).default("all"),
  status: z.enum(["all", "pending", "approved", "rejected"]).default("all"),
  since_days: z.number().int().min(1).max(365).nullable().default(null),
  limit: z.number().int().min(1).max(1000).default(500),
});

export const listHealthPurgeLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => filterSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("health_screenings_purge_log")
      .select("id, original_screening_id, user_id, test_date, valid_until, status, reason, purged_at")
      .order("purged_at", { ascending: false })
      .limit(data.limit);

    if (data.reason !== "all") q = q.eq("reason", data.reason);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.since_days) {
      const since = new Date(Date.now() - data.since_days * 86400_000).toISOString();
      q = q.gte("purged_at", since);
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    const summary = {
      total: rows?.length ?? 0,
      by_reason: {
        expired_validity: 0,
        rejected_retention_expired: 0,
        pending_stale: 0,
      } as Record<string, number>,
      by_status: {
        pending: 0,
        approved: 0,
        rejected: 0,
      } as Record<string, number>,
      last_purge_at: null as string | null,
    };
    for (const r of rows ?? []) {
      summary.by_reason[r.reason] = (summary.by_reason[r.reason] ?? 0) + 1;
      if (r.status) summary.by_status[r.status] = (summary.by_status[r.status] ?? 0) + 1;
      if (!summary.last_purge_at || r.purged_at > summary.last_purge_at) {
        summary.last_purge_at = r.purged_at;
      }
    }

    return { rows: rows ?? [], summary };
  });
