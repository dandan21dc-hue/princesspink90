/**
 * AUD-only plan price table for NOWPayments hosted-invoice checkout.
 * All entries are one-time crypto purchases — every legacy Stripe
 * subscription-style priceId has been removed. The invoice builder rejects
 * any priceId not listed here so the client can't influence the amount
 * charged or ask for a plan the IPN webhook can't grant.
 */
export type PlanPriceSpec = {
  unit_amount: number; // cents
  currency: "aud";
};

export const EXPECTED_PLAN_PRICES: Record<string, PlanPriceSpec> = {
  // Lifetime — grants `lifetime` membership when the webhook settles.
  lifetime_onetime_aud: { unit_amount: 60000, currency: "aud" },
  // Multi-month All-Access Passes — grant term_pass_all_access_<N>d when settled.
  aap_90d_aud: { unit_amount: 2700, currency: "aud" },
  aap_180d_aud: { unit_amount: 5000, currency: "aud" },
  aap_365d_aud: { unit_amount: 9000, currency: "aud" },
  // Note: the 30-day All-Access Pass is minted server-side without a
  // priceId (falls through to the AAP30D default in createNowpaymentsInvoice).
};
