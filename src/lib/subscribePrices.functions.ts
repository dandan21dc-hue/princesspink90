import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import {
  SUBSCRIBE_PRICE_KEYS,
  type SubscribePriceKey,
  type SubscribePrice,
} from "@/lib/subscribePrices.shared";

export { SUBSCRIBE_PRICE_KEYS, type SubscribePriceKey, type SubscribePrice };


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
      const found = new Set(result.data.map((p: any) => p.lookup_key).filter(Boolean) as string[]);
      const missing = data.lookupKeys.filter((k) => !found.has(k));
      if (missing.length > 0) {
        console.error("[plan-price-validation] preflight missing", { missing });
      }
      return { missing };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
