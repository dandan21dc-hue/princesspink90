import { useCallback, useState } from "react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { TermsAgreementGate } from "@/components/TermsAgreementGate";
import type { CheckoutOptions, PaymentProvider } from "../types";

/**
 * Stripe Embedded Checkout provider — the current default for one-time
 * purchases and bookings. Wraps the existing `<StripeEmbeddedCheckout />`
 * component behind the shared `PaymentProvider` interface.
 */
export const stripeProvider: PaymentProvider = {
  id: "stripe",
  useCheckout() {
    const [isOpen, setIsOpen] = useState(false);
    const [options, setOptions] = useState<CheckoutOptions | null>(null);

    const openCheckout = useCallback((opts: CheckoutOptions) => {
      setOptions(opts);
      setIsOpen(true);
    }, []);

    const closeCheckout = useCallback(() => {
      setIsOpen(false);
      setOptions(null);
    }, []);

    const checkoutElement =
      isOpen && options ? (
        <TermsAgreementGate>
          <StripeEmbeddedCheckout {...options} />
        </TermsAgreementGate>
      ) : null;

    return { openCheckout, closeCheckout, isOpen, checkoutElement };
  },
};
