import Stripe from "stripe";

const getEnv = (key: string): string => {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

export type StripeEnv = "sandbox" | "live";

const GATEWAY_STRIPE_BASE = "https://connector-gateway.lovable.dev/stripe";

export function getConnectionApiKey(env: StripeEnv): string {
  return env === "sandbox"
    ? getEnv("STRIPE_SANDBOX_API_KEY")
    : getEnv("STRIPE_LIVE_API_KEY");
}

export function createStripeClient(env: StripeEnv): Stripe {
  const connectionApiKey = getConnectionApiKey(env);
  const lovableApiKey = getEnv("LOVABLE_API_KEY");

  return new Stripe(connectionApiKey, {
    apiVersion: "2026-03-25.dahlia",
    httpClient: Stripe.createFetchHttpClient((input, init) => {
      const stripeUrl = input instanceof Request ? input.url : input.toString();
      const gatewayUrl = stripeUrl.replace("https://api.stripe.com", GATEWAY_STRIPE_BASE);
      return fetch(gatewayUrl, {
        ...init,
        headers: {
          ...Object.fromEntries(
            new Headers(
              init?.headers ?? (input instanceof Request ? input.headers : undefined),
            ).entries(),
          ),
          "X-Connection-Api-Key": connectionApiKey,
          "Lovable-API-Key": lovableApiKey,
        },
      });
    }),
  });
}

export function getStripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const e = error as { message?: string; raw?: { message?: string } };
    return e.raw?.message ?? e.message ?? "Stripe request failed";
  }
  return "Stripe request failed";
}

export async function verifyWebhook(
  req: Request,
  env: StripeEnv,
): Promise<{ id?: string; type: string; data: { object: any } }> {
  const signature = req.headers.get("stripe-signature");
  const body = await req.text();
  return verifyWebhookBody(body, signature, env);
}

export async function verifyWebhookBody(
  body: string,
  signature: string | null,
  env: StripeEnv,
): Promise<{ id?: string; type: string; data: { object: any } }> {
  const secret =
    env === "sandbox"
      ? getEnv("PAYMENTS_SANDBOX_WEBHOOK_SECRET")
      : getEnv("PAYMENTS_LIVE_WEBHOOK_SECRET");

  if (!signature || !body) throw new Error("Missing signature or body");

  let timestamp: string | undefined;
  const v1Signatures: string[] = [];
  for (const part of signature.split(",")) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value;
    if (key === "v1") v1Signatures.push(value);
  }
  if (!timestamp || v1Signatures.length === 0) throw new Error("Invalid signature format");

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error("Webhook timestamp too old");

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signed = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${body}`),
  );
  const expected = Buffer.from(new Uint8Array(signed)).toString("hex");

  if (!v1Signatures.includes(expected)) throw new Error("Invalid webhook signature");

  return JSON.parse(body);
}

/**
 * AUD-only currency guard. All Stripe price creations in this project MUST
 * be denominated in AUD; any attempt to use another currency (notably "usd")
 * — whether from an admin action, an API payload, or a copied source price —
 * is rejected. Always call this helper immediately before passing `currency`
 * to `stripe.prices.create` / `stripe.prices.update`.
 */
export const AUD_CURRENCY = "aud" as const;

export function assertAudCurrency(input: unknown): "aud" {
  const normalized = String(input ?? "").trim().toLowerCase();
  if (normalized === "" || normalized === "aud") return AUD_CURRENCY;
  if (normalized === "usd") {
    throw new Error("USD is not supported — Stripe prices must be created in AUD");
  }
  throw new Error(`Unsupported currency "${normalized}" — Stripe prices must be created in AUD`);
}
