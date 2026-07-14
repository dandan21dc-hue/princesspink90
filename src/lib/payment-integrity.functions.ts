import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const FREQUENCIES = ["every_15m", "hourly", "every_6h", "daily", "weekly"] as const;
export type IntegrityFrequency = (typeof FREQUENCIES)[number];

export const FREQUENCY_LABELS: Record<IntegrityFrequency, string> = {
  every_15m: "Every 15 minutes",
  hourly: "Hourly (top of the hour)",
  every_6h: "Every 6 hours",
  daily: "Daily at 03:00",
  weekly: "Weekly (Mondays 03:00)",
};

export type IntegritySchedule = {
  frequency: IntegrityFrequency;
  timezone: string;
  job_name: string;
  last_applied_schedule: string | null;
  last_applied_at: string | null;
  updated_at: string;
};

export type IntegrityFinding = {
  id: string;
  check_name: string;
  resource_kind: string;
  resource_id: string;
  environment: string;
  severity: "info" | "warning" | "critical";
  detail_json: string;
  first_seen_at: string;
  last_seen_at: string;
  resolved_at: string | null;
};



async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

export const getPaymentIntegrityStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [scheduleRes, findingsRes] = await Promise.all([
      supabaseAdmin.from("payment_integrity_schedule" as any).select("*").eq("id", true).maybeSingle(),
      supabaseAdmin
        .from("payment_integrity_findings" as any)
        .select("*")
        .order("last_seen_at", { ascending: false })
        .limit(100),
    ]);
    if (scheduleRes.error) throw scheduleRes.error;
    if (findingsRes.error) throw findingsRes.error;
    const rawFindings = (findingsRes.data ?? []) as any[];
    const findings: IntegrityFinding[] = rawFindings.map((r) => ({
      id: r.id,
      check_name: r.check_name,
      resource_kind: r.resource_kind,
      resource_id: r.resource_id,
      environment: r.environment,
      severity: r.severity,
      detail_json: JSON.stringify(r.detail ?? {}),
      first_seen_at: r.first_seen_at,
      last_seen_at: r.last_seen_at,
      resolved_at: r.resolved_at,
    }));
    return {
      schedule: (scheduleRes.data ?? null) as unknown as IntegritySchedule | null,
      findings,
    };
  });


export const updatePaymentIntegritySchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { frequency: IntegrityFrequency; timezone: string }) =>
    z
      .object({
        frequency: z.enum(FREQUENCIES),
        timezone: z.string().min(1).max(100),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.rpc(
      "update_payment_integrity_schedule" as any,
      { _frequency: data.frequency, _timezone: data.timezone },
    );
    if (error) throw error;
    return row as unknown as IntegritySchedule;
  });

export const runPaymentIntegrityChecksNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context as any;
    await assertAdmin(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc(
      "run_payment_integrity_checks" as any,
    );
    if (error) throw error;
    return { touched: (data as number) ?? 0 };
  });
