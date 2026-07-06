import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const ALLOWED_EVENTS = new Set([
  "boutique_tier_click",
  "all_access_tier_click",
  "checkout_completed",
]);

type LogInput = {
  event: string;
  plan?: string | null;
  action?: string | null;
  tier_kind?: string | null;
  session_id?: string | null;
  props?: Record<string, unknown>;
};

// Public (unauthenticated) event logger. Whitelist enforced both here and by
// the RLS INSERT policy on analytics_events.
export const logAnalyticsEvent = createServerFn({ method: "POST" })
  .inputValidator((data: LogInput) => {
    if (!data || typeof data.event !== "string") throw new Error("event required");
    if (!ALLOWED_EVENTS.has(data.event)) throw new Error("event not allowed");
    return data;
  })
  .handler(async ({ data }) => {
    const supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { error } = await supabase.from("analytics_events").insert({
      event: data.event,
      plan: data.plan ?? null,
      action: data.action ?? null,
      tier_kind: data.tier_kind ?? null,
      session_id: data.session_id ?? null,
      props: (data.props ?? {}) as Database["public"]["Tables"]["analytics_events"]["Insert"]["props"],
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export type TierAnalyticsRow = {
  plan: string;
  navigate_clicks: number;
  blocked_clicks: number;
  completions: number;
  conversion_rate: number; // completions / navigate_clicks (0..1); 0 when denom=0
};

export type TierAnalytics = {
  since: string;
  total_clicks: number;
  total_completions: number;
  overall_conversion: number;
  rows: TierAnalyticsRow[];
  recent: Array<{
    id: string;
    event: string;
    plan: string | null;
    action: string | null;
    tier_kind: string | null;
    created_at: string;
  }>;
};

export const getTierAnalytics = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sinceDays?: number }) => ({
    sinceDays: Math.max(1, Math.min(365, Number(data?.sinceDays ?? 30))),
  }))
  .handler(async ({ data, context }): Promise<TierAnalytics> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const since = new Date(Date.now() - data.sinceDays * 24 * 60 * 60 * 1000).toISOString();

    const { data: events, error } = await supabaseAdmin
      .from("analytics_events")
      .select("id, event, plan, action, tier_kind, props, created_at")
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(10000);
    if (error) throw new Error(error.message);

    // planId derivation for checkout_completed: use props.plan_id when present,
    // fall back to explicit `plan` column.
    const buckets = new Map<string, { navigate: number; blocked: number; completions: number }>();
    const bump = (plan: string, key: "navigate" | "blocked" | "completions") => {
      const b = buckets.get(plan) ?? { navigate: 0, blocked: 0, completions: 0 };
      b[key] += 1;
      buckets.set(plan, b);
    };

    let totalClicks = 0;
    let totalCompletions = 0;

    for (const e of events ?? []) {
      if (e.event === "boutique_tier_click") {
        totalClicks += 1;
        const plan = e.plan ?? "unknown";
        if (e.action === "blocked") bump(plan, "blocked");
        else bump(plan, "navigate");
      } else if (e.event === "checkout_completed") {
        totalCompletions += 1;
        const props = (e.props ?? {}) as Record<string, unknown>;
        const plan = (props.plan_id as string | undefined) ?? e.plan ?? "unknown";
        bump(plan, "completions");
      }
    }

    const rows: TierAnalyticsRow[] = Array.from(buckets.entries())
      .map(([plan, b]) => ({
        plan,
        navigate_clicks: b.navigate,
        blocked_clicks: b.blocked,
        completions: b.completions,
        conversion_rate: b.navigate > 0 ? b.completions / b.navigate : 0,
      }))
      .sort((a, b) => b.navigate_clicks + b.completions - (a.navigate_clicks + a.completions));

    const recent = (events ?? []).slice(0, 50).map((e) => ({
      id: e.id,
      event: e.event,
      plan: e.plan,
      action: e.action,
      tier_kind: e.tier_kind,
      created_at: e.created_at,
    }));

    return {
      since,
      total_clicks: totalClicks,
      total_completions: totalCompletions,
      overall_conversion: totalClicks > 0 ? totalCompletions / totalClicks : 0,
      rows,
      recent,
    };
  });
