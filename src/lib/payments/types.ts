import type { ReactNode } from "react";

/**
 * Payment intent — what the user is trying to do.
 * A provider may support one, both, or neither. The config in
 * `src/lib/payments/config.ts` decides which provider handles each intent.
 */
export type CheckoutIntent = "one_time" | "subscription";

/**
 * Superset of every field any current call site passes to a checkout.
 * Not every provider consumes every field — one-time-only providers
 * ignore `autoRenew`, booking-unaware providers ignore `bookingStartsAt`,
 * etc. Keep this shape stable across providers so call sites don't have
 * to change when the underlying processor changes.
 */
export interface CheckoutOptions {
  priceId?: string;
  contentItemId?: string;
  pantyListingId?: string;
  returnUrl?: string;
  userId?: string;
  customerEmail?: string;
  bookingStartsAt?: string;
  bookingPartySize?: number;
  bookingNotes?: string;
  autoRenew?: boolean;
}

/**
 * The value every `useCheckout(...)` hook returns. Purposefully identical
 * to the legacy `useStripeCheckout` shape so existing call sites keep
 * working after the refactor.
 */
export interface CheckoutController {
  openCheckout: (opts: CheckoutOptions) => void;
  closeCheckout: () => void;
  isOpen: boolean;
  /** Render this in your JSX; the provider decides whether it's a Stripe
   *  embedded form, a "coming soon" dialog, or something else. */
  checkoutElement: ReactNode;
}

/**
 * A payment provider plugs into the abstraction by exposing a hook.
 * Hooks (not plain functions) so providers can hold React state
 * (open/closed, session tokens, etc.) locally.
 */
export interface PaymentProvider {
  /** Stable identifier, used for logging / analytics. */
  id: string;
  /** React hook that returns the checkout controller for a given intent. */
  useCheckout(intent: CheckoutIntent): CheckoutController;
}
