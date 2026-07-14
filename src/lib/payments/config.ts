import { stripeProvider } from "./providers/stripe";
import { nowpaymentsProvider } from "./providers/nowpayments";
import type { CheckoutIntent, PaymentProvider } from "./types";

/**
 * Single source of truth for which provider handles which intent.
 * Swap a provider by editing this map — call sites don't change.
 *
 * Current state:
 *  - one_time    → Stripe (bookings, store items, panty listings, lifetime)
 *  - subscription → NOWPayments (hosted invoice → 30-day All-Access Pass)
 */
export const paymentProviders: Record<CheckoutIntent, PaymentProvider> = {
  one_time: stripeProvider,
  subscription: nowpaymentsProvider,
};

export function getProvider(intent: CheckoutIntent): PaymentProvider {
  return paymentProviders[intent];
}
