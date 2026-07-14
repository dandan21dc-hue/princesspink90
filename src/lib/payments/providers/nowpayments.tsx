import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { createNowpaymentsInvoice } from "@/lib/nowpayments.functions";
import type { CheckoutOptions, PaymentProvider } from "../types";

/**
 * NOWPayments hosted-checkout provider. Handles the current subscription-
 * style purchase (30-day All-Access Pass) by minting an invoice URL on
 * the server and redirecting the browser to it. The IPN webhook grants
 * the pass when payment settles.
 *
 * One-time / booking checkout still routes through the Stripe provider
 * via `src/lib/payments/config.ts`.
 */
export const nowpaymentsProvider: PaymentProvider = {
  id: "nowpayments",
  useCheckout() {
    const [isOpen, setIsOpen] = useState(false);

    const openCheckout = useCallback(async (opts: CheckoutOptions) => {
      setIsOpen(true);
      try {
        const environment = (import.meta.env.MODE === "production" ? "live" : "sandbox") as
          | "sandbox"
          | "live";
        const result = await createNowpaymentsInvoice({
          data: {
            environment,
            returnOrigin: window.location.origin,
            ...(opts.priceId ? { priceId: opts.priceId } : {}),
          },
        });
        if ("error" in result) {
          toast.error(`Couldn't start checkout: ${result.error}`);
          setIsOpen(false);
          return;
        }
        // Redirect off-site to the NOWPayments hosted invoice page.
        window.location.href = result.invoiceUrl;
      } catch (e) {
        toast.error(`Couldn't start checkout: ${(e as Error).message}`);
        setIsOpen(false);
      }
    }, []);

    const closeCheckout = useCallback(() => setIsOpen(false), []);

    const checkoutElement = isOpen ? (
      <div
        role="status"
        aria-live="polite"
        className="mt-6 flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-6 text-sm"
      >
        <Loader2 className="h-5 w-5 animate-spin text-primary" aria-hidden />
        <div>
          <div className="font-medium">Redirecting you to secure checkout…</div>
          <p className="text-xs text-muted-foreground">
            You'll be sent to NOWPayments to complete payment in crypto.
          </p>
        </div>
      </div>
    ) : null;

    return { openCheckout, closeCheckout, isOpen, checkoutElement };
  },
};
