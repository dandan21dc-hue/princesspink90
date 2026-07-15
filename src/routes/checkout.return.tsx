import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { track } from "@/lib/track";

/**
 * Landing page for NOWPayments' `success_url` / `cancel_url`. The hosted
 * invoice redirects the buyer back here after payment; entitlements are
 * granted asynchronously by the IPN webhook once payment settles, so this
 * page is purely informational.
 *
 * Search params:
 *  - `provider` — always "nowpayments" for redirects we mint.
 *  - `status`   — "success" | "cancel".
 *  - `next`     — optional destination once entitlements are ready.
 */

const ALLOWED_NEXT: readonly string[] = ["/library", "/dashboard", "/store"];

function normalizeNext(next: string | undefined) {
  if (next && ALLOWED_NEXT.includes(next)) return next;
  return "/library";
}

export const Route = createFileRoute("/checkout/return")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    provider: typeof search.provider === "string" ? search.provider : undefined,
    status: typeof search.status === "string" ? search.status : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Finalizing your purchase" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CheckoutReturn,
});

function CheckoutReturn() {
  const { provider, status, next } = Route.useSearch();
  const destination = normalizeNext(next);
  const cancelled = status === "cancel";
  const succeeded = status === "success";

  const trackedRef = useRef(false);
  useEffect(() => {
    if (trackedRef.current) return;
    trackedRef.current = true;
    track("nowpayments_return_page", {
      provider: provider ?? "unknown",
      status: status ?? "unknown",
    });
  }, [provider, status]);

  return (
    <section className="mx-auto max-w-md px-5 py-24 text-center">
      {cancelled ? (
        <>
          <XCircle className="mx-auto h-12 w-12 text-destructive" aria-hidden />
          <h1 className="mt-4 font-display text-2xl font-bold">Payment cancelled</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            No charge was made. You can restart checkout whenever you're ready.
          </p>
        </>
      ) : succeeded ? (
        <>
          <CheckCircle2 className="mx-auto h-12 w-12 text-primary" aria-hidden />
          <h1 className="mt-4 font-display text-2xl font-bold">Payment received</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Thanks — your crypto payment is confirmed. We're finalising your access now;
            it usually appears within a minute or two.
          </p>
        </>
      ) : (
        <>
          <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" aria-hidden />
          <h1 className="mt-4 font-display text-2xl font-bold">Finalising your purchase</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Hang tight while we confirm your payment.
          </p>
        </>
      )}

      <div className="mt-8 flex flex-col items-stretch gap-3">
        <Link
          to={destination}
          className="rounded-md bg-primary px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground"
        >
          Continue
        </Link>
        <Link
          to="/store"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Back to store
        </Link>
      </div>
    </section>
  );
}
