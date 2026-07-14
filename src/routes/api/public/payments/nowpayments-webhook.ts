import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";

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
 * Order ID contract (set when creating the invoice, see billing.functions.ts):
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

// NOWPayments signs a JSON string with keys sorted alphabetically, recursively.
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function verifyNowPaymentsSignature(rawBody: string, headerSig: string | null, secret: string): boolean {
  if (!headerSig) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return false;
  }
  const canonical = stableStringify(parsed);
  const expected = createHmac("sha512", secret).update(canonical).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(headerSig, "utf8");
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

type AapOrder = { kind: "aap30d"; userId: string; environment: "sandbox" | "live"; amountCents: number };

function parseOrderId(orderId: string | undefined): AapOrder | null {
  if (!orderId) return null;
  const parts = orderId.split(":");
  if (parts.length !== 4) return null;
  const [kind, userId, env, amountRaw] = parts;
  if (kind !== "aap30d") return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) return null;
  if (env !== "sandbox" && env !== "live") return null;
  const amountCents = Number(amountRaw);
  if (!Number.isFinite(amountCents) || amountCents < 0 || !Number.isInteger(amountCents)) return null;
  return { kind: "aap30d", userId, environment: env, amountCents };
}

async function processIpn(event: NowPaymentsIpn): Promise<{ handled: boolean; reason?: string }> {
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
    if (error) {
      throw new Error(`grant_all_access_pass_30d failed: ${error.message}`);
    }
    return { handled: true };
  }

  return { handled: false, reason: "unhandled_kind" };
}

export const Route = createFileRoute("/api/public/payments/nowpayments-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
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
      },
    },
  },
});
