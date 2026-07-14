import { getProvider } from "@/lib/payments";
import type { CheckoutController, CheckoutIntent } from "@/lib/payments";

/**
 * Provider-agnostic checkout hook. The concrete provider is chosen by
 * `src/lib/payments/config.ts` — swap providers there, not here.
 *
 * Rules of hooks note: the provider for a given intent is fixed at module
 * load, so `provider.useCheckout(...)` is called in a stable order across
 * renders as long as the intent doesn't change. Don't pass a dynamic
 * intent to the same call site.
 */
export function useCheckout(intent: CheckoutIntent = "one_time"): CheckoutController {
  const provider = getProvider(intent);
  return provider.useCheckout(intent);
}
