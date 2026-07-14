import { stripeProvider } from "./providers/stripe";
import { comingSoonProvider } from "./providers/coming-soon";
import type { CheckoutIntent, PaymentProvider } from "./types";

/**
 * Single source of truth for which provider handles which intent.
 * Swap a provider by editing this map — call sites don't change.
 *
 * Current state:
 *  - one_time    → Stripe (bookings, store items, panty listings, lifetime)
 *  - subscription → Coming Soon (recurring plans disabled during provider swap)
 */
export const paymentProviders: Record<CheckoutIntent, PaymentProvider> = {
  one_time: stripeProvider,
  subscription: comingSoonProvider,
};

export function getProvider(intent: CheckoutIntent): PaymentProvider {
  return paymentProviders[intent];
}
