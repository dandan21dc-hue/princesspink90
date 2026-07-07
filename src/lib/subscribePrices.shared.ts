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
