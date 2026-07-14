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

const inputSchema = z.object({
  environment: z.enum(["all", "sandbox", "live"]).default("all"),
  kind: z
    .enum(["all", "panty", "subscription", "content", "booking"])
    .default("all"),
  limit: z.number().int().min(1).max(200).default(50),
});

export type OrderKind = "panty" | "subscription" | "content" | "booking";

export type WebhookRef = {
  id: string;
  stripe_event_id: string | null;
  event_type: string;
  status: string;
  received_at: string;
  error_message: string | null;
};

export type AdminOrderRow = {
  kind: OrderKind;
  id: string;
  user_id: string | null;
  environment: string;
  amount_cents: number | null;
  currency: string | null;
  payment_status: string;
  entitlement_state: "granted" | "pending" | "revoked";
  entitlement_reason: string;
  reference_id: string | null; // session id or subscription id
  detail: string;
  created_at: string;
  updated_at: string | null;
  last_webhook: WebhookRef | null;
};

function subscriptionEntitlement(row: any): {
  state: AdminOrderRow["entitlement_state"];
  reason: string;
} {
  const status = row.status as string;
  const periodEnd = row.current_period_end
    ? new Date(row.current_period_end).getTime()
    : null;
  const active =
    (["active", "trialing", "past_due"].includes(status) &&
      (periodEnd === null || periodEnd > Date.now())) ||
    (status === "canceled" && periodEnd !== null && periodEnd > Date.now());
  if (active) {
    return {
      state: "granted",
      reason:
        status === "canceled"
          ? "Access until period end"
          : `Subscription ${status}`,
    };
  }
  if (["incomplete", "incomplete_expired", "unpaid"].includes(status)) {
    return { state: "pending", reason: `Awaiting payment (${status})` };
  }
  return { state: "revoked", reason: `Subscription ${status}` };
}

export const listAdminOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => inputSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const sb = supabaseAdmin as any;

    const envFilter = (q: any) =>
      data.environment === "all" ? q : q.eq("environment", data.environment);

    // Fetch each order type in parallel.
    const wantPanty = data.kind === "all" || data.kind === "panty";
    const wantSub = data.kind === "all" || data.kind === "subscription";
    const wantContent = data.kind === "all" || data.kind === "content";
    const wantBooking = data.kind === "all" || data.kind === "booking";

    const [pantyRes, subRes, contentRes, bookingRes] = await Promise.all([
      wantPanty
        ? envFilter(
            sb
              .from("panty_orders")
              .select(
                "id,user_id,environment,amount_cents,currency,status,stripe_session_id,variant,customer_email,created_at,updated_at",
              )
              .order("created_at", { ascending: false })
              .limit(data.limit),
          )
        : Promise.resolve({ data: [], error: null }),
      wantSub
        ? envFilter(
            sb
              .from("subscriptions")
              .select(
                "id,user_id,environment,status,price_id,product_id,stripe_subscription_id,stripe_customer_id,current_period_end,cancel_at_period_end,created_at,updated_at",
              )
              .order("updated_at", { ascending: false })
              .limit(data.limit),
          )
        : Promise.resolve({ data: [], error: null }),
      wantContent
        ? envFilter(
            sb
              .from("content_purchases")
              .select(
                "id,user_id,environment,amount_cents,content_item_id,stripe_session_id,created_at",
              )
              .order("created_at", { ascending: false })
              .limit(data.limit),
          )
        : Promise.resolve({ data: [], error: null }),
      wantBooking
        ? envFilter(
            sb
              .from("private_room_bookings")
              .select(
                "id,user_id,environment,amount_cents,currency,status,stripe_session_id,starts_at,duration_minutes,customer_email,created_at,updated_at",
              )
              .order("created_at", { ascending: false })
              .limit(data.limit),
          )
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const r of [pantyRes, subRes, contentRes, bookingRes]) {
      if ((r as any).error) throw (r as any).error;
    }

    // Collect Stripe reference ids to correlate against webhook events.
    const refIds = new Set<string>();
    for (const p of pantyRes.data ?? [])
      if (p.stripe_session_id) refIds.add(p.stripe_session_id);
    for (const s of subRes.data ?? []) {
      if (s.stripe_subscription_id) refIds.add(s.stripe_subscription_id);
      if (s.stripe_customer_id) refIds.add(s.stripe_customer_id);
    }
    for (const c of contentRes.data ?? [])
      if (c.stripe_session_id) refIds.add(c.stripe_session_id);
    for (const b of bookingRes.data ?? [])
      if (b.stripe_session_id) refIds.add(b.stripe_session_id);

    // Fetch recent webhook events (last 30 days) that reference any of these
    // objects. PostgREST supports JSON extraction in select, so we grab the
    // object id from raw_payload -> data -> object -> id and correlate in
    // memory. Cap at 1000 for the admin view.
    const webhookByRef = new Map<string, WebhookRef>();
    if (refIds.size > 0) {
      const since = new Date(Date.now() - 30 * 86400_000).toISOString();
      let wq = sb
        .from("stripe_webhook_events")
        .select(
          "id, stripe_event_id, event_type, status, received_at, error_message, raw_payload",
        )
        .gte("received_at", since)
        .order("received_at", { ascending: false })
        .limit(1000);
      if (data.environment !== "all") wq = wq.eq("environment", data.environment);
      const { data: whRows, error: whErr } = await wq;
      if (whErr) throw whErr;
      for (const evt of whRows ?? []) {
        const obj = evt?.raw_payload?.data?.object ?? {};
        const candidates: Array<string | undefined> = [
          obj.id,
          obj.subscription,
          obj.customer,
          obj.payment_intent,
        ];
        for (const c of candidates) {
          if (!c || typeof c !== "string" || !refIds.has(c)) continue;
          if (webhookByRef.has(c)) continue; // first hit is most recent
          webhookByRef.set(c, {
            id: evt.id,
            stripe_event_id: evt.stripe_event_id,
            event_type: evt.event_type,
            status: evt.status,
            received_at: evt.received_at,
            error_message: evt.error_message,
          });
        }
      }
    }

    const rows: AdminOrderRow[] = [];

    for (const p of pantyRes.data ?? []) {
      const entitled = ["paid", "shipped", "delivered"].includes(p.status);
      const revoked = ["refunded", "canceled", "disputed"].includes(p.status);
      rows.push({
        kind: "panty",
        id: p.id,
        user_id: p.user_id,
        environment: p.environment,
        amount_cents: p.amount_cents,
        currency: p.currency,
        payment_status: p.status,
        entitlement_state: revoked
          ? "revoked"
          : entitled
            ? "granted"
            : "pending",
        entitlement_reason: revoked
          ? `Order ${p.status}`
          : entitled
            ? "Order fulfilled — access granted"
            : "Awaiting payment confirmation",
        reference_id: p.stripe_session_id,
        detail: `${p.variant}${p.customer_email ? ` · ${p.customer_email}` : ""}`,
        created_at: p.created_at,
        updated_at: p.updated_at,
        last_webhook: p.stripe_session_id
          ? (webhookByRef.get(p.stripe_session_id) ?? null)
          : null,
      });
    }

    for (const s of subRes.data ?? []) {
      const { state, reason } = subscriptionEntitlement(s);
      rows.push({
        kind: "subscription",
        id: s.id,
        user_id: s.user_id,
        environment: s.environment,
        amount_cents: null,
        currency: null,
        payment_status: s.status,
        entitlement_state: state,
        entitlement_reason: reason,
        reference_id: s.stripe_subscription_id,
        detail: `${s.price_id}${s.cancel_at_period_end ? " · cancels at period end" : ""}`,
        created_at: s.created_at,
        updated_at: s.updated_at,
        last_webhook:
          (s.stripe_subscription_id
            ? webhookByRef.get(s.stripe_subscription_id)
            : undefined) ??
          (s.stripe_customer_id
            ? webhookByRef.get(s.stripe_customer_id)
            : undefined) ??
          null,
      });
    }

    for (const c of contentRes.data ?? []) {
      rows.push({
        kind: "content",
        id: c.id,
        user_id: c.user_id,
        environment: c.environment,
        amount_cents: c.amount_cents,
        currency: "aud",
        payment_status: "paid",
        entitlement_state: "granted",
        entitlement_reason: "One-time purchase recorded",
        reference_id: c.stripe_session_id,
        detail: `content_item ${c.content_item_id}`,
        created_at: c.created_at,
        updated_at: null,
        last_webhook: c.stripe_session_id
          ? (webhookByRef.get(c.stripe_session_id) ?? null)
          : null,
      });
    }

    for (const b of bookingRes.data ?? []) {
      const entitled = b.status === "confirmed";
      const revoked = ["canceled", "refunded"].includes(b.status);
      rows.push({
        kind: "booking",
        id: b.id,
        user_id: b.user_id,
        environment: b.environment,
        amount_cents: b.amount_cents,
        currency: b.currency,
        payment_status: b.status,
        entitlement_state: revoked
          ? "revoked"
          : entitled
            ? "granted"
            : "pending",
        entitlement_reason: revoked
          ? `Booking ${b.status}`
          : entitled
            ? "Booking confirmed"
            : "Awaiting payment confirmation",
        reference_id: b.stripe_session_id,
        detail: `${b.starts_at} · ${b.duration_minutes}m${b.customer_email ? ` · ${b.customer_email}` : ""}`,
        created_at: b.created_at,
        updated_at: b.updated_at,
        last_webhook: b.stripe_session_id
          ? (webhookByRef.get(b.stripe_session_id) ?? null)
          : null,
      });
    }

    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const summary = {
      total: rows.length,
      granted: rows.filter((r) => r.entitlement_state === "granted").length,
      pending: rows.filter((r) => r.entitlement_state === "pending").length,
      revoked: rows.filter((r) => r.entitlement_state === "revoked").length,
    };

    return { rows, summary };
  });
