/**
 * Legacy shim. Stripe was removed in favor of NOWPayments. Existing call
 * sites still import `useStripeCheckout` / `useSubscriptionComingSoon`
 * from here — route both to the provider registry in `@/lib/payments`.
 */
import { getProvider } from "@/lib/payments";
import type { CheckoutController } from "@/lib/payments/types";

export function useStripeCheckout(): CheckoutController {
  return getProvider("one_time").useCheckout("one_time");
}

export function useSubscriptionComingSoon(): CheckoutController {
  return getProvider("subscription").useCheckout("subscription");
}
