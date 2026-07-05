import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

const filterSchema = z.object({
  status: z.enum(["all", "queued", "sent", "failed"]).default("all"),
  reminder_type: z.string().max(50).default("all"),
  since_days: z.number().int().min(1).max(365).nullable().default(30),
  screening_id: z.string().uuid().nullable().default(null),
  limit: z.number().int().min(1).max(1000).default(500),
});

export const listHealthReminderLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => filterSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;

    let q = sb
      .from("health_screening_reminder_log")
      .select(
        "id, screening_id, user_id, reminder_type, valid_until, channels, status, error_message, idempotency_key, created_at, attempt_count, max_attempts, last_attempt_at, next_retry_at",
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.reminder_type !== "all")
      q = q.eq("reminder_type", data.reminder_type);
    if (data.screening_id) q = q.eq("screening_id", data.screening_id);
    if (data.since_days) {
      const since = new Date(
        Date.now() - data.since_days * 86400_000,
      ).toISOString();
      q = q.gte("created_at", since);
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    const summary = {
      total: rows?.length ?? 0,
      queued: 0,
      sent: 0,
      failed: 0,
      last_attempt_at: null as string | null,
      types: new Set<string>(),
    };
    for (const r of rows ?? []) {
      if (r.status === "queued") summary.queued++;
      else if (r.status === "sent") summary.sent++;
      else if (r.status === "failed") summary.failed++;
      if (!summary.last_attempt_at || r.created_at > summary.last_attempt_at)
        summary.last_attempt_at = r.created_at;
      if (r.reminder_type) summary.types.add(r.reminder_type);
    }

    return {
      rows: rows ?? [],
      summary: {
        total: summary.total,
        queued: summary.queued,
        sent: summary.sent,
        failed: summary.failed,
        last_attempt_at: summary.last_attempt_at,
        reminder_types: Array.from(summary.types).sort(),
      },
    };
  });
