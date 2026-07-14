import { nowpaymentsProvider } from "./providers/nowpayments";
import type { CheckoutIntent, PaymentProvider } from "./types";

/**
 * Single source of truth for which provider handles which intent.
 * Every Buy/Subscribe click now routes through NOWPayments — the hook
 * mints an invoice server-side and redirects the browser to the hosted
 * `invoice_url`. Swap a provider by editing this map; call sites don't
 * change.
 */
export const paymentProviders: Record<CheckoutIntent, PaymentProvider> = {
  one_time: nowpaymentsProvider,
  subscription: nowpaymentsProvider,
};

export function getProvider(intent: CheckoutIntent): PaymentProvider {
  return paymentProviders[intent];
}
