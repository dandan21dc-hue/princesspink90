import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type BookingRejectionRow = {
  id: string;
  user_id: string | null;
  attempt_kind: "create" | "reschedule_self" | "reschedule_admin";
  attempted_starts_at: string | null;
  duration_minutes: number | null;
  reason_code: string;
  reason_message: string;
  booking_id: string | null;
  conflict_booking_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
};

export type BookingRejectionSummary = {
  total: number;
  byKind: Record<string, number>;
  byReason: Record<string, number>;
};

/**
 * Admin-only report of rejected private-room booking attempts. Reads from
 * `booking_rejection_log`, which is populated whenever a create or
 * reschedule server function throws a user-facing rejection.
 */
export const listBookingRejections = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      sinceDays?: number | null;
      attemptKind?: "all" | "create" | "reschedule_self" | "reschedule_admin";
      reasonCode?: string | "all";
      limit?: number;
    }) => data,
  )
  .handler(async ({ data, context }) => {
    // Verify admin — RLS also blocks non-admins, but explicit checks give a
    // cleaner error and let us early-exit without hitting the DB.
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Admin access required");

    let query = context.supabase
      .from("booking_rejection_log")
      .select(
        "id,user_id,attempt_kind,attempted_starts_at,duration_minutes,reason_code,reason_message,booking_id,conflict_booking_ids,metadata,created_at",
      )
      .order("created_at", { ascending: false })
      .limit(Math.min(Math.max(data.limit ?? 200, 1), 1000));

    if (data.sinceDays && data.sinceDays > 0) {
      const since = new Date(Date.now() - data.sinceDays * 24 * 60 * 60 * 1000);
      query = query.gte("created_at", since.toISOString());
    }
    if (data.attemptKind && data.attemptKind !== "all") {
      query = query.eq("attempt_kind", data.attemptKind);
    }
    if (data.reasonCode && data.reasonCode !== "all") {
      query = query.eq("reason_code", data.reasonCode);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    const list = (rows ?? []) as BookingRejectionRow[];
    const summary: BookingRejectionSummary = {
      total: list.length,
      byKind: {},
      byReason: {},
    };
    for (const r of list) {
      summary.byKind[r.attempt_kind] = (summary.byKind[r.attempt_kind] ?? 0) + 1;
      summary.byReason[r.reason_code] = (summary.byReason[r.reason_code] ?? 0) + 1;
    }

    return { rows: list, summary };
  });
