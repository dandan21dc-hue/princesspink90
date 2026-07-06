import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import {
  getBillingSummary,
  cancelSubscription,
  resumeSubscription,
  listMyInvoices,
  createSetupSession,
  finaliseSetupSession,
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

function BillingPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [invoices, setInvoices] = useState<Invoices | null>(null);
  const [busy, setBusy] = useState(false);
  const [showUpdateCard, setShowUpdateCard] = useState(false);

  const env = getStripeEnvironment();
  const fetchSummary = useServerFn(getBillingSummary);
  const fetchInvoices = useServerFn(listMyInvoices);
  const doCancel = useServerFn(cancelSubscription);
  const doResume = useServerFn(resumeSubscription);
  const doFinalise = useServerFn(finaliseSetupSession);

  async function reload() {
    const [s, i] = await Promise.all([
      fetchSummary({ data: { environment: env } }),
      fetchInvoices({ data: { environment: env } }),
    ]);
    setSummary(s);
    setInvoices(i);
  }

  useEffect(() => {
    reload();
    // If we returned from a card-update setup session, finalise it.
    const url = new URL(window.location.href);
    const sessionId = url.searchParams.get("session_id");
    const purpose = url.searchParams.get("purpose");
    if (sessionId && purpose === "setup") {
      doFinalise({ data: { environment: env, sessionId } }).then((res) => {
        if ("error" in res) toast.error(res.error);
        else {
          toast.success("Card updated.");
          reload();
        }
        url.searchParams.delete("session_id");
        url.searchParams.delete("purpose");
        window.history.replaceState({}, "", url.toString());
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!summary) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if ("error" in summary) return <p className="text-sm text-red-400">{summary.error}</p>;

  const sub = summary.subscription;
  const hasSub = !!sub && sub.status !== "canceled";

  async function onCancel() {
    if (!confirm("Cancel at end of current period? You'll keep access until then.")) return;
    setBusy(true);
    const res = await doCancel({ data: { environment: env } });
    setBusy(false);
    if ("error" in res) return toast.error(res.error);
    toast.success("Cancellation scheduled.");
    reload();
  }

  async function onResume() {
    setBusy(true);
    const res = await doResume({ data: { environment: env } });
    setBusy(false);
    if ("error" in res) return toast.error(res.error);
    toast.success("Subscription resumed.");
    reload();
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl">Billing</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cancel or resume your plan, update your card, view invoices.
        </p>
      </div>

      <section className="rounded-lg border border-border p-5">
        <h2 className="font-display text-lg">Plan</h2>
        {!hasSub ? (
          <p className="mt-2 text-sm text-muted-foreground">
            You don't have an active subscription.
          </p>
        ) : (
          <div className="mt-3 space-y-3 text-sm">
            <div>
              Status: <span className="font-semibold">{sub!.status}</span>
              {sub!.status === "past_due" && (
                <span className="ml-2 rounded bg-red-500/20 px-2 py-0.5 text-red-400">
                  payment failed
                </span>
              )}
            </div>
            {sub!.current_period_end && (
              <div>
                {sub!.cancel_at_period_end ? "Access ends" : "Renews"} on{" "}
                <span className="font-semibold">
                  {new Date(sub!.current_period_end).toLocaleDateString()}
                </span>
              </div>
            )}
            <div className="pt-2">
              {sub!.cancel_at_period_end ? (
                <button
                  onClick={onResume}
                  disabled={busy}
                  className="rounded bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                >
                  Resume subscription
                </button>
              ) : (
                <button
                  onClick={onCancel}
                  disabled={busy}
                  className="rounded border border-border px-3 py-2 text-sm font-semibold hover:bg-white/5 disabled:opacity-50"
                >
                  Cancel subscription
                </button>
              )}
            </div>
          </div>
        )}
      </section>

      {summary.hasCustomer && (
        <section className="rounded-lg border border-border p-5">
          <h2 className="font-display text-lg">Payment method</h2>
          {summary.defaultPaymentMethod ? (
            <p className="mt-2 text-sm">
              {summary.defaultPaymentMethod.brand.toUpperCase()} ····{" "}
              {summary.defaultPaymentMethod.last4}
              <span className="ml-2 text-muted-foreground">
                exp {String(summary.defaultPaymentMethod.exp_month).padStart(2, "0")}/
                {String(summary.defaultPaymentMethod.exp_year).slice(-2)}
              </span>
            </p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No card on file.</p>
          )}
          <button
            onClick={() => setShowUpdateCard(true)}
            className="mt-3 rounded border border-border px-3 py-2 text-sm font-semibold hover:bg-white/5"
          >
            {summary.defaultPaymentMethod ? "Update card" : "Add card"}
          </button>
          {showUpdateCard && <UpdateCard onDone={() => setShowUpdateCard(false)} />}
        </section>
      )}

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
                  {inv.hosted_invoice_url && (
                    <a
                      href={inv.hosted_invoice_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-neon hover:underline"
                    >
                      view
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No invoices yet.</p>
        )}
      </section>
    </div>
  );
}

function UpdateCard({ onDone }: { onDone: () => void }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const createSetup = useServerFn(createSetupSession);
  const env = getStripeEnvironment();

  useEffect(() => {
    const returnUrl = `${window.location.origin}/account/billing?purpose=setup`;
    createSetup({ data: { environment: env, returnUrl } }).then((res) => {
      if ("error" in res) setError(res.error);
      else setClientSecret(res.clientSecret);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <p className="mt-4 text-sm text-red-400">{error}</p>;
  if (!clientSecret) return <p className="mt-4 text-sm text-muted-foreground">Preparing secure form…</p>;

  return (
    <div className="mt-4">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret: async () => clientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
      <button
        onClick={onDone}
        className="mt-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Close
      </button>
    </div>
  );
}
