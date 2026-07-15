import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * User-facing order history. Reads only rows owned by the caller via RLS
 * (using the authenticated Supabase client from `requireSupabaseAuth`) and
 * projects a single row shape covering NOWPayments invoice status and the
 * derived entitlement state per order.
 *
 * The NOWPayments IPN webhook writes `external_payment_reference` on each
 * row when it grants (or reconciles) an entitlement. We surface that as the
 * invoice/payment reference the buyer can quote in support.
 */

export type MyOrderKind =
  | "panty"
  | "content"
  | "booking"
  | "all_access_pass"
  | "lifetime";

export type MyOrderRow = {
  kind: MyOrderKind;
  id: string;
  environment: string;
  amount_cents: number | null;
  currency: string | null;
  /** NOWPayments-side status, or a derived label when the underlying row
   *  has no explicit payment status column. */
  invoice_status: string;
  entitlement_state: "active" | "granted" | "pending" | "expired" | "revoked";
  entitlement_reason: string;
  /** Human-readable descriptor of what was purchased. */
  detail: string;
  /** `nowpayments:<payment_id>` when the IPN has landed, or null while pending. */
  payment_reference: string | null;
  created_at: string;
  /** For memberships: when access lapses. Null for lifetime and one-shots. */
  expires_at: string | null;
};

function fmtMoney(cents: number | null | undefined, currency: string | null | undefined) {
  if (cents == null) return "";
  return `${(currency ?? "AUD").toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

export const listMyOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const sb = context.supabase as any;
    const userId = context.userId;

    const [pantyRes, contentRes, bookingRes, membershipsRes] = await Promise.all([
      sb
        .from("panty_orders")
        .select(
          "id,environment,amount_cents,currency,status,external_payment_reference,variant,created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      sb
        .from("content_purchases")
        .select(
          "id,environment,amount_cents,content_item_id,external_payment_reference,created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      sb
        .from("private_room_bookings")
        .select(
          "id,environment,amount_cents,currency,status,external_payment_reference,starts_at,duration_minutes,created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      sb
        .from("memberships")
        .select(
          "id,kind,environment,amount_cents,expires_at,external_payment_reference,created_at",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    for (const r of [pantyRes, contentRes, bookingRes, membershipsRes]) {
      if ((r as any).error) throw (r as any).error;
    }

    const rows: MyOrderRow[] = [];
    const now = Date.now();

    for (const p of pantyRes.data ?? []) {
      const paid = ["paid", "shipped", "delivered"].includes(p.status);
      const revoked = ["refunded", "canceled", "disputed"].includes(p.status);
      const pending = !paid && !revoked;
      rows.push({
        kind: "panty",
        id: p.id,
        environment: p.environment,
        amount_cents: p.amount_cents,
        currency: p.currency,
        invoice_status: p.external_payment_reference
          ? pending
            ? "invoice awaiting payment"
            : "invoice paid"
          : "invoice pending",
        entitlement_state: revoked ? "revoked" : paid ? "granted" : "pending",
        entitlement_reason: revoked
          ? `Order ${p.status}`
          : paid
            ? `Order ${p.status} — access granted`
            : "Awaiting NOWPayments confirmation",
        detail: `Panty listing · ${p.variant} · ${fmtMoney(p.amount_cents, p.currency)}`.trim(),
        payment_reference: p.external_payment_reference ?? null,
        created_at: p.created_at,
        expires_at: null,
      });
    }

    for (const c of contentRes.data ?? []) {
      rows.push({
        kind: "content",
        id: c.id,
        environment: c.environment,
        amount_cents: c.amount_cents,
        currency: "aud",
        invoice_status: c.external_payment_reference ? "invoice paid" : "invoice pending",
        entitlement_state: "granted",
        entitlement_reason: "One-time content purchase — access granted",
        detail: `Content item ${c.content_item_id} · ${fmtMoney(c.amount_cents, "aud")}`,
        payment_reference: c.external_payment_reference ?? null,
        created_at: c.created_at,
        expires_at: null,
      });
    }

    for (const b of bookingRes.data ?? []) {
      const confirmed = b.status === "confirmed";
      const revoked = ["canceled", "refunded"].includes(b.status);
      rows.push({
        kind: "booking",
        id: b.id,
        environment: b.environment,
        amount_cents: b.amount_cents,
        currency: b.currency,
        invoice_status: b.external_payment_reference
          ? confirmed
            ? "invoice paid"
            : "invoice awaiting payment"
          : "invoice pending",
        entitlement_state: revoked ? "revoked" : confirmed ? "granted" : "pending",
        entitlement_reason: revoked
          ? `Booking ${b.status}`
          : confirmed
            ? "Booking confirmed — slot reserved"
            : "Awaiting NOWPayments confirmation",
        detail: `Private room · ${new Date(b.starts_at).toLocaleString()} · ${b.duration_minutes}m`,
        payment_reference: b.external_payment_reference ?? null,
        created_at: b.created_at,
        expires_at: null,
      });
    }

    for (const m of membershipsRes.data ?? []) {
      const isLifetime = m.kind === "lifetime";
      const expiresMs = m.expires_at ? Date.parse(m.expires_at) : null;
      const active = isLifetime || (expiresMs != null && expiresMs > now);
      const rowKind: MyOrderKind = isLifetime ? "lifetime" : "all_access_pass";
      rows.push({
        kind: rowKind,
        id: m.id,
        environment: m.environment,
        amount_cents: m.amount_cents,
        currency: "aud",
        invoice_status: m.external_payment_reference
          ? "invoice paid"
          : "granted (no invoice on file)",
        entitlement_state: active ? "active" : "expired",
        entitlement_reason: isLifetime
          ? "Lifetime membership — never expires"
          : active && expiresMs != null
            ? `Access until ${new Date(expiresMs).toLocaleString()}`
            : "Pass expired — buy again to regain access",
        detail: `${isLifetime ? "Lifetime membership" : "All-Access Pass"} · ${m.kind}`,
        payment_reference: m.external_payment_reference ?? null,
        created_at: m.created_at,
        expires_at: m.expires_at ?? null,
      });
    }

    rows.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const summary = {
      total: rows.length,
      active: rows.filter((r) => r.entitlement_state === "active").length,
      granted: rows.filter((r) => r.entitlement_state === "granted").length,
      pending: rows.filter((r) => r.entitlement_state === "pending").length,
      expired: rows.filter((r) => r.entitlement_state === "expired").length,
      revoked: rows.filter((r) => r.entitlement_state === "revoked").length,
    };

    return { rows, summary };
  });
