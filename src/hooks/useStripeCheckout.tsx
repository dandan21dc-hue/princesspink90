import { useCallback, useState } from "react";
import { Clock } from "lucide-react";
import { StripeEmbeddedCheckout } from "@/components/StripeEmbeddedCheckout";
import { TermsAgreementGate } from "@/components/TermsAgreementGate";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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

/**
 * Subscriptions are temporarily disabled while the subscription provider is
 * being swapped. Use this hook in place of `openCheckout(...)` for any
 * recurring/subscription CTA. One-time purchases and bookings continue to
 * use `useStripeCheckout` above.
 */
export function useSubscriptionComingSoon() {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  const element = (
    <Dialog open={open} onOpenChange={(v) => !v && hide()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Clock className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center">Subscriptions coming soon</DialogTitle>
          <DialogDescription className="text-center">
            We're switching subscription providers. Recurring plans are
            temporarily unavailable — one-time purchases and bookings are
            unaffected. Please check back shortly.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex justify-center">
          <Button onClick={hide}>Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { show, hide, isOpen: open, element };
}
