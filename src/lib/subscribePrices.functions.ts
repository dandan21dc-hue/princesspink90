import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

/** Human-readable AUD price lookup keys shown on /store/subscribe. */
export const SUBSCRIBE_PRICE_KEYS = [
  "all_access_monthly_aud",
  "all_access_3mo_monthly_aud",
  "all_access_6mo_monthly_aud",
  "all_access_12mo_monthly_aud",
  "lifetime_onetime_aud",
  "panty_24hr_aud",
  "panty_48hr_aud",
  "panty_72hr_aud",
] as const;

export type SubscribePriceKey = (typeof SUBSCRIBE_PRICE_KEYS)[number];

export interface SubscribePrice {
  lookup_key: SubscribePriceKey;
  unit_amount: number;
  currency: string;
  recurring: { interval: string } | null;
}

/**
 * Live-reads current prices for the /store/subscribe page from Stripe so the
 * UI never drifts from the catalogue. Returns a map keyed by lookup_key.
 */
export const getSubscribePrices = createServerFn({ method: "GET" })
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data }): Promise<{ prices: Record<string, SubscribePrice> } | { error: string }> => {
    try {
      const stripe = createStripeClient(data.environment);
      const result = await stripe.prices.list({
        lookup_keys: [...SUBSCRIBE_PRICE_KEYS],
        active: true,
        limit: 20,
      });
      const map: Record<string, SubscribePrice> = {};
      for (const p of result.data) {
        if (!p.lookup_key) continue;
        map[p.lookup_key] = {
          lookup_key: p.lookup_key as SubscribePriceKey,
          unit_amount: p.unit_amount ?? 0,
          currency: p.currency,
          recurring: p.recurring ? { interval: p.recurring.interval } : null,
        };
      }
      return { prices: map };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/**
 * Preflight: given a list of Stripe lookup_keys, returns which ones do
 * NOT resolve to an active price. Called from the client before opening
 * Stripe checkout so we can surface a clear error instead of letting the
 * checkout session fail with a generic "Price not found".
 */
export const checkPricesExist = createServerFn({ method: "POST" })
  .inputValidator((data: { environment: StripeEnv; lookupKeys: string[] }) => {
    if (!Array.isArray(data.lookupKeys) || data.lookupKeys.length === 0) {
      throw new Error("lookupKeys required");
    }
    for (const key of data.lookupKeys) {
      if (typeof key !== "string" || !/^[a-zA-Z0-9_-]+$/.test(key)) {
        throw new Error("Invalid lookup key");
      }
    }
    return data;
  })
  .handler(async ({ data }): Promise<{ missing: string[] } | { error: string }> => {
    try {
      const stripe = createStripeClient(data.environment);
      const result = await stripe.prices.list({
        lookup_keys: data.lookupKeys,
        active: true,
        limit: 100,
      });
      const found = new Set(result.data.map((p) => p.lookup_key).filter(Boolean) as string[]);
      const missing = data.lookupKeys.filter((k) => !found.has(k));
      if (missing.length > 0) {
        console.error("[plan-price-validation] preflight missing", { missing });
      }
      return { missing };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
