import { useCallback, useState } from "react";
import { Clock } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

// Payments are temporarily disabled. This hook preserves the previous API
// (openCheckout / closeCheckout / isOpen / checkoutElement) so existing
// button call sites keep working, but every attempt now surfaces a
// "Coming soon" dialog instead of launching a checkout session.

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

  const openCheckout = useCallback((_opts: CheckoutOptions) => {
    setIsOpen(true);
  }, []);

  const closeCheckout = useCallback(() => {
    setIsOpen(false);
  }, []);

  const checkoutElement = (
    <Dialog open={isOpen} onOpenChange={(open) => !open && closeCheckout()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
            <Clock className="h-6 w-6" aria-hidden="true" />
          </div>
          <DialogTitle className="text-center">Payments coming soon</DialogTitle>
          <DialogDescription className="text-center">
            Online checkout is temporarily unavailable while we finish setting
            up our new payment processor. Please check back shortly.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex justify-center">
          <Button onClick={closeCheckout}>Got it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );

  return { openCheckout, closeCheckout, isOpen, checkoutElement };
}
