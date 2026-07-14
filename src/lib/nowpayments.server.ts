// Server-only helpers for NOWPayments. Never import this from a client
// module — the filename suffix keeps the bundler from following it into
// client chunks.
import { createHmac, timingSafeEqual } from "crypto";

const NOWPAYMENTS_API_BASE = "https://api.nowpayments.io/v1";

// NOWPayments signs the JSON body after sorting keys alphabetically,
// recursively, using HMAC-SHA512 with the IPN secret.
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function verifyNowPaymentsSignature(
  rawBody: string,
  headerSig: string | null,
  secret: string,
): boolean {
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

export interface CreateInvoiceInput {
  priceAmount: number; // in fiat units, e.g. 10.00
  priceCurrency: string; // e.g. "aud"
  orderId: string; // opaque order id we later parse in the webhook
  orderDescription?: string;
  successUrl?: string;
  cancelUrl?: string;
  ipnCallbackUrl: string;
}

export interface CreatedInvoice {
  id: string;
  invoice_url: string;
  order_id: string;
}

/**
 * POST /v1/invoice — creates a hosted-checkout invoice URL. The user is
 * redirected there, picks a crypto to pay with, and NOWPayments hits our
 * IPN webhook when the payment settles.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<CreatedInvoice> {
  const apiKey = process.env.NOWPAYMENTS_API_KEY;
  if (!apiKey) throw new Error("NOWPAYMENTS_API_KEY is not configured");

  const res = await fetch(`${NOWPAYMENTS_API_BASE}/invoice`, {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      price_amount: input.priceAmount,
      price_currency: input.priceCurrency,
      order_id: input.orderId,
      order_description: input.orderDescription,
      ipn_callback_url: input.ipnCallbackUrl,
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`NOWPayments invoice failed (${res.status}): ${text.slice(0, 400)}`);
  }
  let body: { id?: string | number; invoice_url?: string; order_id?: string };
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`NOWPayments returned non-JSON: ${text.slice(0, 200)}`);
  }
  if (!body.invoice_url || !body.id) {
    throw new Error(`NOWPayments response missing invoice_url/id: ${text.slice(0, 200)}`);
  }
  return {
    id: String(body.id),
    invoice_url: body.invoice_url,
    order_id: String(body.order_id ?? input.orderId),
  };
}
