/**
 * Payments environment resolver. Stripe was removed; NOWPayments is the only
 * processor. This module keeps the historical `getStripeEnvironment` export
 * name so the many call sites that already import it don't need to churn.
 */
export type StripeEnv = "sandbox" | "live";

export function getStripeEnvironment(): StripeEnv {
  return import.meta.env.MODE === "production" ? "live" : "sandbox";
}
