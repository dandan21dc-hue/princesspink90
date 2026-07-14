// Backwards-compatible wrapper — delegates to the payment provider
// abstraction in `src/lib/payments`. Prefer `useCheckout(...)` in new code.
//
// Historical call sites use:
//   const { openCheckout, ... } = useStripeCheckout();   // → one-time
//   const sub = useSubscriptionComingSoon();             // → subscription
//
// Both now go through the provider registry, so swapping Stripe (or the
// subscription placeholder) is a one-line change in `payments/config.ts`.
import { useCheckout } from "./useCheckout";
import type { CheckoutController } from "@/lib/payments";

export function useStripeCheckout(): CheckoutController {
  return useCheckout("one_time");
}

/**
 * Legacy helper — kept so existing `subComingSoon.show()` / `.element`
 * call sites keep compiling. Under the hood it's just the subscription
 * provider's checkout controller, exposed with the old field names.
 */
export function useSubscriptionComingSoon() {
  const controller = useCheckout("subscription");
  return {
    show: () => controller.openCheckout({}),
    hide: controller.closeCheckout,
    isOpen: controller.isOpen,
    element: controller.checkoutElement,
  };
}
