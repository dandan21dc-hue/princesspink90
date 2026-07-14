import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLocation } from "@tanstack/react-router";

type PaymentPendingPlaceholderProps = {
  title?: string;
  message?: string;
  /** Estimated processing time shown to the user. Defaults to a Stripe-typical window. */
  estimatedTime?: string;
  className?: string;
};

/**
 * Shared placeholder shown on Store and Panty pages while a payment is
 * being authorised / confirmed. Purely presentational.
 */
export function PaymentPendingPlaceholder({
  title = "Payment pending",
  message = "We're confirming your payment with the processor. You can safely stay on this page — we'll update it automatically once it's complete.",
  estimatedTime = "Usually 5–30 seconds, occasionally up to a few minutes for bank verification.",
  className,
}: PaymentPendingPlaceholderProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "mt-8 flex items-start gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-6",
        className,
      )}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Clock className="h-5 w-5 animate-pulse" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">{title}</div>
        <p className="mt-2 text-sm text-muted-foreground">{message}</p>
        <p className="mt-2 text-xs text-muted-foreground/80">
          <span className="font-medium text-foreground/80">Estimated time:</span> {estimatedTime}
        </p>
        <p className="mt-1 text-xs text-muted-foreground/70">
          Further checkout attempts are disabled until this one settles to avoid double-charging.
        </p>
      </div>
    </div>
  );
}

/**
 * Shared signal — true whenever the current URL carries `?payment=pending`.
 * Use to render <PaymentPendingPlaceholder /> AND to gate checkout triggers
 * so a user can't start a second Stripe session while the first is settling.
 */
export function usePaymentPending(): boolean {
  const location = useLocation();
  return /(?:^|[?&])payment=pending(?:&|$)/.test(location.searchStr ?? "");
}

export default PaymentPendingPlaceholder;
