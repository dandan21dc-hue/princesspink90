import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type ReminderJobConfig = {
  daily_run_time_utc: string; // "HH:MM" (UTC)
  expiring_within_days: number;
  updated_at: string | null;
};

const DEFAULT_CONFIG: ReminderJobConfig = {
  daily_run_time_utc: "08:00",
  expiring_within_days: 7,
  updated_at: null,
};

// "HH:MM" or "HH:MM:SS" → "HH:MM"
function normalizeTime(value: string): string {
  return value.slice(0, 5);
}

export const getReminderJobConfig = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReminderJobConfig> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("reminder_job_config")
      .select("daily_run_time_utc, expiring_within_days, updated_at")
      .eq("id", "default")
      .maybeSingle();
    if (error) throw error;
    if (!data) return DEFAULT_CONFIG;
    return {
      daily_run_time_utc: normalizeTime(data.daily_run_time_utc as unknown as string),
      expiring_within_days:
        (data as { expiring_within_days?: number }).expiring_within_days ?? 7,
      updated_at: data.updated_at,
    };
  });

const updateSchema = z.object({
  daily_run_time_utc: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Must be HH:MM (24h UTC)"),
  expiring_within_days: z
    .number()
    .int()
    .min(1, "Must be at least 1 day")
    .max(90, "Must be at most 90 days"),
});

export const updateReminderJobConfig = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { daily_run_time_utc: string; expiring_within_days: number }) =>
      updateSchema.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { error } = await context.supabase
      .from("reminder_job_config")
      .update({
        daily_run_time_utc: `${data.daily_run_time_utc}:00`,
        expiring_within_days: data.expiring_within_days,
        updated_by: context.userId,
      })
      .eq("id", "default");
    if (error) throw error;
    return {
      ok: true,
      daily_run_time_utc: data.daily_run_time_utc,
      expiring_within_days: data.expiring_within_days,
    };
  });

/**
 * Public read-only accessor used by the reminder job itself. Falls back to
 * sensible defaults (08:00 UTC, 7-day window) when the row is missing.
 */
export async function readReminderJobConfig(): Promise<{
  daily_run_time_utc: string;
  expiring_within_days: number;
}> {
  const sb = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data } = await sb
    .from("reminder_job_config")
    .select("daily_run_time_utc, expiring_within_days")
    .eq("id", "default")
    .maybeSingle();
  const rawTime = (data?.daily_run_time_utc as unknown as string) ?? "08:00";
  const days =
    (data as { expiring_within_days?: number } | null)?.expiring_within_days ?? 7;
  return {
    daily_run_time_utc: normalizeTime(rawTime),
    expiring_within_days: days,
  };
}

/** Back-compat helper. */
export async function readDailyRunTimeUtc(): Promise<string> {
  return (await readReminderJobConfig()).daily_run_time_utc;
}
