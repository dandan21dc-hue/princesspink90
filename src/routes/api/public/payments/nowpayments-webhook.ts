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

  // panty — 5 parts: panty:<listingId>:<userId>:<env>:<amountCents>
  if (parts.length === 5) {
    const [kind, pantyListingId, userId, envRaw, amountRaw] = parts;
    if (kind !== "panty") return null;
    if (!UUID_RE.test(pantyListingId) || !UUID_RE.test(userId)) return null;
    const environment = parseEnv(envRaw);
    if (!environment) return null;
    const amountCents = parseAmount(amountRaw);
    if (amountCents == null) return null;
    return { kind: "panty", pantyListingId, userId, environment, amountCents };
  }

  return null;
}

export async function processIpn(event: NowPaymentsIpn): Promise<{ handled: boolean; reason?: string }> {
  const status = String(event.payment_status ?? "").toLowerCase();

  // Only grant entitlements on a confirmed, settled payment. All other statuses
  // (waiting, confirming, confirmed, sending, partially_paid, failed, refunded, expired)
  // are acknowledged with 200 so NOWPayments stops retrying, but grant nothing.
  if (status !== "finished") {
    return { handled: false, reason: `ignored_status:${status || "missing"}` };
  }

  const order = parseOrderId(event.order_id);
  if (!order) {
    return { handled: false, reason: "unrecognised_order_id" };
  }

  const paymentRef = event.payment_id != null ? `nowpayments:${String(event.payment_id)}` : null;
  if (!paymentRef) {
    return { handled: false, reason: "missing_payment_id" };
  }

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  if (order.kind === "aap30d") {
    const { error } = await supabaseAdmin.rpc("grant_all_access_pass_30d", {
      _user_id: order.userId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
    });
    if (error) throw new Error(`grant_all_access_pass_30d failed: ${error.message}`);
    return { handled: true };
  }

  if (order.kind === "lifetime") {
    const { error } = await supabaseAdmin.rpc("grant_lifetime_membership", {
      _user_id: order.userId,
      _environment: order.environment,
      _amount_cents: order.amountCents,
      _external_payment_reference: paymentRef,
    });
    if (error) throw new Error(`grant_lifetime_membership failed: ${error.message}`);
    return { handled: true };
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
    return { handled: true };
  }

  return { handled: false, reason: "unhandled_kind" };
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
