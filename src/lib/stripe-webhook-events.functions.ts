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
  status: z
    .enum(["all", "received", "processing", "succeeded", "failed", "ignored"])
    .default("all"),
  environment: z.enum(["all", "sandbox", "live"]).default("all"),
  event_type: z.string().max(120).default("all"),
  since_days: z.number().int().min(1).max(365).nullable().default(7),
  search: z.string().max(200).nullable().default(null),
  limit: z.number().int().min(1).max(500).default(200),
});

export type StripeWebhookEventRow = {
  id: string;
  stripe_event_id: string | null;
  event_type: string;
  environment: string;
  status: string;
  error_message: string | null;
  processing_ms: number | null;
  received_at: string;
  processed_at: string | null;
  raw_payload: any;
};

export const listStripeWebhookEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => filterSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const sb = supabaseAdmin as any;

    let q = sb
      .from("stripe_webhook_events")
      .select(
        "id, stripe_event_id, event_type, environment, status, error_message, processing_ms, received_at, processed_at, raw_payload",
      )
      .order("received_at", { ascending: false })
      .limit(data.limit);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.environment !== "all") q = q.eq("environment", data.environment);
    if (data.event_type !== "all") q = q.eq("event_type", data.event_type);
    if (data.since_days) {
      const since = new Date(
        Date.now() - data.since_days * 86400_000,
      ).toISOString();
      q = q.gte("received_at", since);
    }
    if (data.search) {
      q = q.or(
        `stripe_event_id.ilike.%${data.search}%,error_message.ilike.%${data.search}%`,
      );
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    // Summary counts (over the returned window using a separate lightweight query).
    let summaryQ = sb.from("stripe_webhook_events").select("status", {
      count: "exact",
      head: false,
    });
    if (data.environment !== "all")
      summaryQ = summaryQ.eq("environment", data.environment);
    if (data.since_days) {
      const since = new Date(
        Date.now() - data.since_days * 86400_000,
      ).toISOString();
      summaryQ = summaryQ.gte("received_at", since);
    }
    const { data: summaryRows } = await summaryQ.limit(5000);
    const counts: Record<string, number> = {
      received: 0,
      processing: 0,
      succeeded: 0,
      failed: 0,
      ignored: 0,
    };
    for (const r of summaryRows ?? []) {
      const s = (r as any).status as string;
      counts[s] = (counts[s] ?? 0) + 1;
    }

    // Distinct event types for the filter dropdown.
    const { data: typeRows } = await sb
      .from("stripe_webhook_events")
      .select("event_type")
      .order("event_type", { ascending: true })
      .limit(2000);
    const eventTypesSet = new Set<string>();
    for (const r of typeRows ?? []) {
      const v = (r as any)?.event_type;
      if (typeof v === "string" && v) eventTypesSet.add(v);
    }
    const eventTypes: string[] = Array.from(eventTypesSet).sort();

    return {
      rows: (rows ?? []) as StripeWebhookEventRow[],
      summary: {
        counts,
        total:
          counts.received +
          counts.processing +
          counts.succeeded +
          counts.failed +
          counts.ignored,
      },
      eventTypes,
    };
  });
