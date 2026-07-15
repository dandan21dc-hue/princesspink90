import { createFileRoute } from "@tanstack/react-router";
import { verifyNowPaymentsSignature } from "@/lib/nowpayments.server";

/**
 * NOWPayments IPN webhook.
 *
 * URL: /api/public/payments/nowpayments-webhook
 *   (Configure this exact URL in NOWPayments dashboard → Store Settings → IPN callback URL.)
 *
 * Security:
 *  - `/api/public/*` bypasses Lovable's published-site auth, so security is enforced here by
 *    verifying the `x-nowpayments-sig` header (HMAC-SHA512 over the JSON body with keys
 *    sorted alphabetically, using NOWPAYMENTS_IPN_SECRET). Anything unverified is rejected.
 *  - Entitlements are only granted when `payment_status === "finished"`.
 *  - Idempotency lives in the database function (`grant_all_access_pass_30d`): the
 *    NOWPayments `payment_id` is stored as `external_payment_reference` with a unique
 *    constraint, so a webhook redelivered twice grants the pass only once.
 *
 * Order ID contract (set when creating the invoice, see nowpayments.functions.ts):
 *   All-Access Pass:  aap30d:<userId>:<sandbox|live>:<amountCents>
 * Anything else is logged and acknowledged (200) so NOWPayments stops retrying it.
 */

type NowPaymentsIpn = {
  payment_id?: number | string;
  payment_status?: string;
  order_id?: string;
  order_description?: string;
  price_amount?: number | string;
  price_currency?: string;
  pay_amount?: number | string;
  pay_currency?: string;
  actually_paid?: number | string;
  purchase_id?: string;
  [k: string]: unknown;
};


const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ParsedOrder =
  | { kind: "aap30d"; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | { kind: "lifetime"; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | {
      kind: "panty";
      pantyListingId: string;
      userId: string;
      environment: "sandbox" | "live";
      amountCents: number;
    }
  | {
      kind: "booking";
      bookingId: string;
      userId: string;
      environment: "sandbox" | "live";
      amountCents: number;
    };

function parseEnv(v: string): "sandbox" | "live" | null {
  return v === "sandbox" || v === "live" ? v : null;
}

function parseAmount(v: string): number | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return null;
  return n;
}

export function parseOrderId(orderId: string | undefined): ParsedOrder | null {
  if (!orderId) return null;
  const parts = orderId.split(":");

  // aap30d / lifetime — 4 parts: <kind>:<userId>:<env>:<amountCents>
  if (parts.length === 4) {
    const [kind, userId, envRaw, amountRaw] = parts;
    if (kind !== "aap30d" && kind !== "lifetime") return null;
    if (!UUID_RE.test(userId)) return null;
    const environment = parseEnv(envRaw);
    if (!environment) return null;
    const amountCents = parseAmount(amountRaw);
    if (amountCents == null) return null;
    return { kind: kind as "aap30d" | "lifetime", userId, environment, amountCents };
  }

  // panty / booking — 5 parts: <kind>:<uuid>:<userId>:<env>:<amountCents>
  if (parts.length === 5) {
    const [kind, entityId, userId, envRaw, amountRaw] = parts;
    if (kind !== "panty" && kind !== "booking") return null;
    if (!UUID_RE.test(entityId) || !UUID_RE.test(userId)) return null;
    const environment = parseEnv(envRaw);
    if (!environment) return null;
    const amountCents = parseAmount(amountRaw);
    if (amountCents == null) return null;
    if (kind === "panty") {
      return { kind: "panty", pantyListingId: entityId, userId, environment, amountCents };
    }
    return { kind: "booking", bookingId: entityId, userId, environment, amountCents };
  }

  return null;
}

export async function processIpn(event: NowPaymentsIpn): Promise<{ handled: boolean; reason?: string; duplicate?: boolean }> {
  const status = String(event.payment_status ?? "").toLowerCase();
  const paymentIdRaw = event.payment_id != null ? String(event.payment_id) : null;

  if (!paymentIdRaw) {
    return { handled: false, reason: "missing_payment_id" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  // Ledger-first idempotency: record the IPN before doing any work. If a row
  // for this payment_id already exists, this is a redelivery — bump the
  // counter and short-circuit with the original outcome instead of re-running
  // the grant path. This protects against concurrent retries that would
  // otherwise race past the per-RPC external_payment_reference check.
  const { data: inserted, error: insertErr } = await supabaseAdmin
    .from("nowpayments_ipn_events")
    .insert({
      payment_id: paymentIdRaw,
      first_status: status || "unknown",
      last_status: status || "unknown",
      order_id: event.order_id ?? null,
      payload: event as unknown as never,
    })
    .select("payment_id")
    .maybeSingle();

  const duplicateCode = insertErr && (insertErr as { code?: string }).code === "23505";
  if (!inserted || duplicateCode) {
    if (insertErr && !duplicateCode) {
      throw new Error(`ipn ledger insert failed: ${insertErr.message}`);
    }
    // Redelivery: bump seen counters + latest status, return original outcome.
    const { data: prior } = await supabaseAdmin
      .from("nowpayments_ipn_events")
      .select("handled, reason, received_count")
      .eq("payment_id", paymentIdRaw)
      .maybeSingle();
    await supabaseAdmin
      .from("nowpayments_ipn_events")
      .update({
        last_status: status || "unknown",
        last_seen_at: new Date().toISOString(),
        received_count: (prior?.received_count ?? 1) + 1,
      })
      .eq("payment_id", paymentIdRaw);
    return {
      handled: Boolean(prior?.handled),
      reason: prior?.reason ?? "duplicate_ipn",
      duplicate: true,
    };
  }

  const finalize = async (outcome: { handled: boolean; reason?: string }) => {
    await supabaseAdmin
      .from("nowpayments_ipn_events")
      .update({
        handled: outcome.handled,
        reason: outcome.reason ?? null,
        processed_at: new Date().toISOString(),
        last_status: status || "unknown",
        last_seen_at: new Date().toISOString(),
      })
      .eq("payment_id", paymentIdRaw);
    return outcome;
  };

  // Only grant entitlements on a confirmed, settled payment. All other statuses
  // (waiting, confirming, confirmed, sending, partially_paid, failed, refunded, expired)
  // are acknowledged with 200 so NOWPayments stops retrying, but grant nothing.
  if (status !== "finished") {
    return finalize({ handled: false, reason: `ignored_status:${status || "missing"}` });
  }

  const order = parseOrderId(event.order_id);
  if (!order) {
    return finalize({ handled: false, reason: "unrecognised_order_id" });
  }

  const paymentRef = `nowpayments:${paymentIdRaw}`;

  if (order.kind === "aap30d") {
    const { error } = await supabaseAdmin.rpc("grant_all_access_pass_30d", {
      _user_id: order.userId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
    });
    if (error) throw new Error(`grant_all_access_pass_30d failed: ${error.message}`);
    return finalize({ handled: true });
  }

  if (order.kind === "lifetime") {
    const { error } = await supabaseAdmin.rpc("grant_lifetime_membership", {
      _user_id: order.userId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
    });
    if (error) throw new Error(`grant_lifetime_membership failed: ${error.message}`);
    return finalize({ handled: true });
  }

  if (order.kind === "panty") {
    const { error } = await supabaseAdmin.rpc("grant_panty_listing_order", {
      _user_id: order.userId,
      _panty_listing_id: order.pantyListingId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
    });
    if (error) throw new Error(`grant_panty_listing_order failed: ${error.message}`);
    return finalize({ handled: true });
  }

  if (order.kind === "booking") {
    // Idempotent: external_payment_reference is UNIQUE on
    // private_room_bookings. If this payment ref already claimed the row
    // (or another) the update returns 0 rows and we no-op.
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("private_room_bookings")
      .select("id, status, external_payment_reference, amount_cents, environment, user_id")
      .eq("id", order.bookingId)
      .maybeSingle();
    if (fetchErr) throw new Error(`booking lookup failed: ${fetchErr.message}`);
    if (!existing) return finalize({ handled: false, reason: "booking_not_found" });
    if (existing.user_id !== order.userId) {
      return finalize({ handled: false, reason: "booking_user_mismatch" });
    }
    if (existing.external_payment_reference && existing.external_payment_reference !== paymentRef) {
      return finalize({ handled: false, reason: "booking_already_paid" });
    }
    if (existing.status === "confirmed" && existing.external_payment_reference === paymentRef) {
      return finalize({ handled: true }); // already processed
    }
    const { error } = await supabaseAdmin
      .from("private_room_bookings")
      .update({
        status: "confirmed",
        external_payment_reference: paymentRef,
        amount_cents: order.amountCents,
        environment: order.environment,
      })
      .eq("id", order.bookingId);
    if (error) throw new Error(`confirm booking failed: ${error.message}`);
    return finalize({ handled: true });
  }

  return finalize({ handled: false, reason: "unhandled_kind" });
}

export async function handleWebhookRequest(request: Request): Promise<Response> {
  const secret = process.env.NOWPAYMENTS_IPN_SECRET;
  if (!secret) {
    console.error("NOWPAYMENTS_IPN_SECRET is not configured");
    return new Response("Server misconfigured", { status: 500 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("x-nowpayments-sig");

  if (!verifyNowPaymentsSignature(rawBody, signature, secret)) {
    console.warn("NOWPayments webhook: invalid signature");
    return new Response("Invalid signature", { status: 401 });
  }

  let event: NowPaymentsIpn;
  try {
    event = JSON.parse(rawBody) as NowPaymentsIpn;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  try {
    const result = await processIpn(event);
    // Always return 200 for verified events so NOWPayments does not retry
    // (retries on non-2xx last up to several days).
    return Response.json({
      received: true,
      handled: result.handled,
      ...(result.reason ? { reason: result.reason } : {}),
    });
  } catch (e) {
    // Only genuine processing errors (e.g. RPC failure) return 5xx so NOWPayments retries.
    console.error("NOWPayments webhook processing error:", e);
    return new Response("Webhook processing error", { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/payments/nowpayments-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => handleWebhookRequest(request),
    },
  },
});
