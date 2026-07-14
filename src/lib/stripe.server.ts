/**
 * Compatibility shim. Stripe has been removed from the project — NOWPayments
 * is the only payment processor. These exports exist only so legacy imports
 * across the codebase still resolve during the multi-file cleanup. All
 * runtime callers should be migrated to NOWPayments; the stub client throws
 * if anything actually tries to call Stripe.
 */
export type StripeEnv = "sandbox" | "live";

export const AUD_CURRENCY = "aud" as const;

export function assertAudCurrency(input?: string | null): "aud" {
  const v = (input ?? "").toString().trim().toLowerCase();
  if (v && v !== "aud") {
    throw new Error(`Only AUD is supported. Received: ${input}`);
  }
  return "aud";
}

function stripeRemoved(): never {
  throw new Error("Stripe has been removed. Use NOWPayments.");
}

// Return type is `any` so `ReturnType<typeof createStripeClient>` collapses to
// `any` at call sites — no need for a `Stripe` type dependency.
export function createStripeClient(_env: StripeEnv): any {
  return new Proxy(
    {},
    {
      get() {
        stripeRemoved();
      },
    },
  );
}

export function getStripeErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unknown error";
}
