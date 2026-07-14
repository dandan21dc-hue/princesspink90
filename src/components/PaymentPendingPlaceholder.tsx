import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";

type PaymentPendingPlaceholderProps = {
  title?: string;
  message?: string;
  className?: string;
};

/**
 * Shared placeholder shown on Store and Panty pages while a payment
 * is being authorised / confirmed. Pure presentational component —
 * safe to render in any suspense/error boundary.
 */
export function PaymentPendingPlaceholder({
  title = "Payment pending",
  message = "We're confirming your payment with the processor. This usually takes a few seconds — you can safely stay on this page.",
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
      </div>
    </div>
  );
}

export default PaymentPendingPlaceholder;
