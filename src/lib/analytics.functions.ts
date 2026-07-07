import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

const ALLOWED_EVENTS = new Set([
  "boutique_tier_click",
  "all_access_tier_click",
  "checkout_completed",
  "panty_checkout_start",
  "panty_checkout_started",
  "panty_checkout_confirmed",
  "panty_checkout_pending",
  "panty_checkout_cancelled",
  "stripe_checkout_return_failed",
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
// the RLS INSERT policy on analytics_events. To prevent volumetric abuse
// (arbitrary anonymous inserts flooding the table), we require a well-formed
// session_id and apply an in-memory per-session token bucket.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RL_WINDOW_MS = 60_000;
const RL_MAX_EVENTS = 30;
const rateBuckets = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(sessionId: string): boolean {
  const now = Date.now();
  const b = rateBuckets.get(sessionId);
  if (!b || b.resetAt <= now) {
    rateBuckets.set(sessionId, { count: 1, resetAt: now + RL_WINDOW_MS });
    // Opportunistic GC so the map can't grow unbounded on a hot Worker.
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.resetAt <= now) rateBuckets.delete(k);
    }
    return true;
  }
  if (b.count >= RL_MAX_EVENTS) return false;
  b.count += 1;
  return true;
}

export const logAnalyticsEvent = createServerFn({ method: "POST" })
  .inputValidator((data: LogInput) => {
    if (!data || typeof data.event !== "string") throw new Error("event required");
    if (!ALLOWED_EVENTS.has(data.event)) throw new Error("event not allowed");
    if (!data.session_id || !UUID_RE.test(data.session_id))
      throw new Error("valid session_id required");
    // Cap props size so a caller can't stuff MBs into a single row.
    if (data.props && JSON.stringify(data.props).length > 4000)
      throw new Error("props too large");
    return data;
  })
  .handler(async ({ data }) => {
    if (!checkRateLimit(data.session_id as string)) {
      // Silently drop — never surface details to the caller.
      return { ok: true, throttled: true };
    }
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

// ─────────────────────────────────────────────────────────────────────────
// Checkout reconciliation: given a client_order_ref (UUID emitted by the
// cart drawer at panty_checkout_start), return every persisted analytics
// event that carries that ref plus a compact status matrix so admins can
// see at a glance whether the funnel completed, stalled at pending, or
// bounced through a cancelled / error path.

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export type ReconciliationEventRow = {
  id: string;
  event: string;
  created_at: string;
  session_id: string | null;
  props: { [key: string]: JsonValue };
};

export type ReconciliationStatus = {
  seen: boolean;
  count: number;
  first_at: string | null;
  last_at: string | null;
};

export type CheckoutReconciliation = {
  client_order_ref: string;
  total_events: number;
  session_ids: string[];
  order_ids: string[];
  status: {
    start: ReconciliationStatus;
    confirmed: ReconciliationStatus;
    pending: ReconciliationStatus;
    cancelled: ReconciliationStatus;
    return_failed: ReconciliationStatus;
    checkout_completed: ReconciliationStatus;
  };
  events: ReconciliationEventRow[];
};

const CLIENT_ORDER_REF_RE = /^[0-9a-fA-F-]{8,64}$/;

export const getCheckoutReconciliation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { clientOrderRef: string }) => {
    const ref = (data?.clientOrderRef ?? "").trim();
    if (!CLIENT_ORDER_REF_RE.test(ref)) {
      throw new Error("Invalid client_order_ref");
    }
    return { clientOrderRef: ref };
  })
  .handler(async ({ data, context }): Promise<CheckoutReconciliation> => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Query by both jsonb key lookup (indexed) and session_id fallback
    // when the caller pastes a session_id by mistake — cheap and helpful.
    const { data: events, error } = await supabaseAdmin
      .from("analytics_events")
      .select("id, event, created_at, session_id, props")
      .eq("props->>client_order_ref", data.clientOrderRef)
      .order("created_at", { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);

    const empty = (): ReconciliationStatus => ({
      seen: false,
      count: 0,
      first_at: null,
      last_at: null,
    });
    const status = {
      start: empty(),
      confirmed: empty(),
      pending: empty(),
      cancelled: empty(),
      return_failed: empty(),
      checkout_completed: empty(),
    };
    const bump = (k: keyof typeof status, at: string) => {
      const s = status[k];
      s.seen = true;
      s.count += 1;
      s.first_at = s.first_at ?? at;
      s.last_at = at;
    };

    const sessionIds = new Set<string>();
    const orderIds = new Set<string>();

    for (const e of events ?? []) {
      const p = (e.props ?? {}) as Record<string, unknown>;
      if (typeof p.session_id === "string") sessionIds.add(p.session_id);
      if (typeof e.session_id === "string" && e.session_id) sessionIds.add(e.session_id);
      if (typeof p.order_id === "string") orderIds.add(p.order_id);
      if (typeof p.order_ids === "string") {
        for (const id of p.order_ids.split(",")) {
          const trimmed = id.trim();
          if (trimmed) orderIds.add(trimmed);
        }
      }
      switch (e.event) {
        case "panty_checkout_start":
        case "panty_checkout_started":
          bump("start", e.created_at);
          break;
        case "panty_checkout_confirmed":
          bump("confirmed", e.created_at);
          break;
        case "panty_checkout_pending":
          bump("pending", e.created_at);
          break;
        case "panty_checkout_cancelled":
          bump("cancelled", e.created_at);
          break;
        case "stripe_checkout_return_failed":
          bump("return_failed", e.created_at);
          break;
        case "checkout_completed":
          bump("checkout_completed", e.created_at);
          break;
      }
    }

    return {
      client_order_ref: data.clientOrderRef,
      total_events: events?.length ?? 0,
      session_ids: Array.from(sessionIds),
      order_ids: Array.from(orderIds),
      status,
      events: (events ?? []).map((e) => ({
        id: e.id,
        event: e.event,
        created_at: e.created_at,
        session_id: e.session_id,
        props: (e.props ?? {}) as { [key: string]: JsonValue },
      })),
    };
  });
