/**
 * Payments environment resolver. Stripe was removed; NOWPayments is the only
 * processor. This module keeps the historical `getStripeEnvironment` export
 * name so the many call sites that already import it don't need to churn.
 */
export type StripeEnv = "sandbox" | "live";

export function getStripeEnvironment(): StripeEnv {
  return import.meta.env.MODE === "production" ? "live" : "sandbox";
}

/**
 * Compatibility shim. Historically returned a Stripe.js `loadStripe` promise;
 * Stripe has been removed from the project so this now resolves to `null`.
 * Kept so legacy `<EmbeddedCheckoutProvider stripe={getStripe()}>` call sites
 * still typecheck while their surrounding pages are migrated / deleted.
 */
export function getStripe(): Promise<any> {
  return Promise.resolve(null);
}
