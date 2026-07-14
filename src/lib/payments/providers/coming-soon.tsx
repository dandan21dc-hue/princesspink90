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
import type { CheckoutIntent, PaymentProvider } from "../types";

/**
 * Placeholder provider used while a real provider is being swapped in.
 * Any attempt to open checkout shows a "coming soon" dialog and no
 * payment is initiated.
 */
export const comingSoonProvider: PaymentProvider = {
  id: "coming-soon",
  useCheckout(intent: CheckoutIntent) {
    const [isOpen, setIsOpen] = useState(false);
    const openCheckout = useCallback(() => setIsOpen(true), []);
    const closeCheckout = useCallback(() => setIsOpen(false), []);

    const label = intent === "subscription" ? "Subscriptions" : "Payments";
    const body =
      intent === "subscription"
        ? "We're switching subscription providers. Recurring plans are temporarily unavailable — one-time purchases and bookings are unaffected."
        : "Checkout is temporarily unavailable while we finish setting up our payment processor. Please check back shortly.";

    const checkoutElement = (
      <Dialog open={isOpen} onOpenChange={(v) => !v && closeCheckout()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
              <Clock className="h-6 w-6" aria-hidden="true" />
            </div>
            <DialogTitle className="text-center">{label} coming soon</DialogTitle>
            <DialogDescription className="text-center">{body}</DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex justify-center">
            <Button onClick={closeCheckout}>Got it</Button>
          </div>
        </DialogContent>
      </Dialog>
    );

    return { openCheckout, closeCheckout, isOpen, checkoutElement };
  },
};
