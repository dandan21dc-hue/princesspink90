import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getStripeEnvironment } from "@/lib/stripe";
import {
  getBillingSummary,
  listMyInvoices,
} from "@/lib/billing.functions";

export const Route = createFileRoute("/_authenticated/account/billing")({
  component: BillingPage,
});

type Summary = Awaited<ReturnType<typeof getBillingSummary>>;
type Invoices = Awaited<ReturnType<typeof listMyInvoices>>;

function formatMoney(cents: number, currency: string) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: currency.toUpperCase(),
  }).format(cents / 100);
}

/**
 * Billing overview. Stripe was removed — subscriptions, hosted invoices, and
 * saved-card management are no longer available, so this page is a read-only
 * placeholder that surfaces whatever the stubbed server fns return (currently
 * always empty). Purchases now flow through NOWPayments as one-time payments;
 * ongoing access is expressed via `memberships`.
 */
function BillingPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoices | null>(null);

  const env = getStripeEnvironment();
  const fetchSummary = useServerFn(getBillingSummary);
  const fetchInvoices = useServerFn(listMyInvoices);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetchSummary({ data: { environment: env } }),
      fetchInvoices({ data: { environment: env } }),
    ]).then(([s, i]) => {
      if (cancelled) return;
      setSummary(s);
      setInvoices(i);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!summary) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if ("error" in summary) return <p className="text-sm text-red-400">{summary.error}</p>;

  const sub = summary.subscription;
  const hasSub = !!sub && sub.status !== "canceled";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Your purchases are one-time payments via NOWPayments. There's nothing
          to manage here — pass expiry and current entitlements live on your
          account page.
        </p>
      </div>

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-lg">Plan</h2>
        {!hasSub ? (
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have an active subscription. All-Access Passes are
            purchased upfront and expire on their own — no renewals to cancel.
          </p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              Status: <span className="font-semibold">{sub!.status}</span>
            </div>
            {sub!.current_period_end && (
              <div>
                Access ends on{" "}
                <span className="font-semibold">
                  {new Date(sub!.current_period_end).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-lg">Invoices</h2>
        {invoices && !("error" in invoices) && invoices.length > 0 ? (
          <ul className="mt-3 divide-y divide-border text-sm">
            {invoices.map((inv) => (
              <li key={inv.id} className="flex items-center justify-between py-2">
                <span>
                  {inv.number ?? inv.id}
                  <span className="ml-2 text-muted-foreground">
                    {new Date(inv.created * 1000).toLocaleDateString()}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <span>{formatMoney(inv.amount_paid, inv.currency)}</span>
                  <span className="text-xs text-muted-foreground">{inv.status}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            Hosted invoices aren't issued for crypto payments. Your NOWPayments
            receipt is your proof of purchase.
          </p>
        )}
      </section>
    </div>
  );
}
