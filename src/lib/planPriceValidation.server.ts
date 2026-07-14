/**
 * AUD-only plan price table. Was previously used by the Stripe price-parity
 * validator; now the only remaining consumer is the NOWPayments invoice
 * builder, which needs a trusted amount+currency lookup server-side so the
 * client can't influence what a user is charged.
 */
export type PlanPriceSpec = {
  unit_amount: number; // cents
  currency: "aud";
};

export const EXPECTED_PLAN_PRICES: Record<string, PlanPriceSpec> = {
  all_access_monthly_aud: { unit_amount: 1900, currency: "aud" },
  all_access_3mo_monthly_aud: { unit_amount: 5400, currency: "aud" },
  all_access_6mo_monthly_aud: { unit_amount: 9900, currency: "aud" },
  all_access_12mo_monthly_aud: { unit_amount: 18900, currency: "aud" },
  lifetime_onetime_aud: { unit_amount: 49900, currency: "aud" },
};
