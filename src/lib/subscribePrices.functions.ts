import { createServerFn } from "@tanstack/react-start";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";

/** Human-readable AUD price lookup keys shown on /store/subscribe. */
export const SUBSCRIBE_PRICE_KEYS = [
  "all_access_monthly_aud",
  "all_access_3mo_onetime_aud",
  "all_access_6mo_onetime_aud",
  "all_access_12mo_onetime_aud",
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
