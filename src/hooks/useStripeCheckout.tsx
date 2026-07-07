import { useCallback, useState } from "react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { TermsAgreementGate } from "@/components/TermsAgreementGate";

interface CheckoutOptions {
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


export function useStripeCheckout() {
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
}
