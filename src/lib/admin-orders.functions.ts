import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Admin order status. The legacy `subscriptions` and `stripe_webhook_events`
 * tables were dropped when Stripe was removed, so the reconciliation columns
 * (`last_webhook`, subscription rows) are stubbed out. External payment
 * references now come from NOWPayments IPNs via `external_payment_reference`
 * on each row.
 */

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
  reference_id: string | null;
  detail: string;
  created_at: string;
  updated_at: string | null;
  /**
   * Kept in the row shape for UI compatibility. Always null now that the
   * Stripe webhook events table is gone; NOWPayments IPNs are logged
   * elsewhere.
   */
  last_webhook: WebhookRef | null;
};

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

    const wantPanty = data.kind === "all" || data.kind === "panty";
    const wantContent = data.kind === "all" || data.kind === "content";
    const wantBooking = data.kind === "all" || data.kind === "booking";
    // The `subscription` kind is intentionally a no-op: there is no
    // subscriptions table anymore. Recurring access lives in `memberships`
    // and is surfaced by the entitlements admin page instead.

    const [pantyRes, contentRes, bookingRes] = await Promise.all([
      wantPanty
        ? envFilter(
            sb
              .from("panty_orders")
              .select(
                "id,user_id,environment,amount_cents,currency,status,external_payment_reference,variant,customer_email,created_at,updated_at",
              )
              .order("created_at", { ascending: false })
              .limit(data.limit),
          )
        : Promise.resolve({ data: [], error: null }),
      wantContent
        ? envFilter(
            sb
              .from("content_purchases")
              .select(
                "id,user_id,environment,amount_cents,content_item_id,external_payment_reference,created_at",
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
                "id,user_id,environment,amount_cents,currency,status,external_payment_reference,starts_at,duration_minutes,customer_email,created_at,updated_at",
              )
              .order("created_at", { ascending: false })
              .limit(data.limit),
          )
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const r of [pantyRes, contentRes, bookingRes]) {
      if ((r as any).error) throw (r as any).error;
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
        reference_id: p.external_payment_reference ?? null,
        detail: `${p.variant}${p.customer_email ? ` · ${p.customer_email}` : ""}`,
        created_at: p.created_at,
        updated_at: p.updated_at,
        last_webhook: null,
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
        reference_id: c.external_payment_reference ?? null,
        detail: `content_item ${c.content_item_id}`,
        created_at: c.created_at,
        updated_at: null,
        last_webhook: null,
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
        reference_id: b.external_payment_reference ?? null,
        detail: `${b.starts_at} · ${b.duration_minutes}m${b.customer_email ? ` · ${b.customer_email}` : ""}`,
        created_at: b.created_at,
        updated_at: b.updated_at,
        last_webhook: null,
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
