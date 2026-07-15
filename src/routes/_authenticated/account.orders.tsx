import { Fragment, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyOrders, type MyOrderRow } from "@/lib/orders.functions";

export const Route = createFileRoute("/_authenticated/account/orders")({
  head: () => ({
    meta: [
      { title: "My orders — Midnight Glory" },
      {
        name: "description",
        content:
          "Your NOWPayments invoice status and current entitlement for every purchase, pass and booking.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: MyOrdersPage,
});

const STATE_STYLES: Record<MyOrderRow["entitlement_state"], string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  granted: "bg-emerald-500/15 text-emerald-400",
  pending: "bg-amber-500/15 text-amber-400",
  expired: "bg-muted/40 text-muted-foreground",
  revoked: "bg-destructive/15 text-destructive",
};

const KIND_LABEL: Record<MyOrderRow["kind"], string> = {
  panty: "Panty order",
  content: "Content purchase",
  booking: "Room booking",
  all_access_pass: "All-Access Pass",
  lifetime: "Lifetime membership",
};

function fmtMoney(cents: number | null, currency: string | null) {
  if (cents == null) return "—";
  return `${(currency ?? "aud").toUpperCase()} ${(cents / 100).toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function MyOrdersPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const fn = useServerFn(listMyOrders);
  const query = useQuery({
    queryKey: ["my-orders"],
    queryFn: () => fn({}),
    refetchInterval: 30_000,
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary ?? {
    total: 0,
    active: 0,
    granted: 0,
    pending: 0,
    expired: 0,
    revoked: 0,
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
        <Link
          to="/account"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Account
        </Link>
        <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">
          Account
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold">My orders</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Every purchase, pass and booking on your account with its
          NOWPayments invoice status and the entitlement it granted. Pending
          rows update automatically once the crypto payment settles.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Total" value={summary.total} />
          <SummaryCard label="Active" value={summary.active} tone="ok" />
          <SummaryCard label="Granted" value={summary.granted} tone="ok" />
          <SummaryCard label="Pending" value={summary.pending} tone="warn" />
          <SummaryCard label="Expired / revoked" value={summary.expired + summary.revoked} />
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="mb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-busy={query.isFetching}
            className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-xs font-medium uppercase tracking-widest text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className={`inline-block h-3 w-3 rounded-full border-2 border-primary/40 border-t-primary ${
                query.isFetching ? "animate-spin" : ""
              }`}
            />
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
          {query.dataUpdatedAt ? (
            <span className="text-[11px] uppercase tracking-widest text-muted-foreground">
              Updated {fmtDate(new Date(query.dataUpdatedAt).toISOString())}
            </span>
          ) : null}
        </div>

        {query.isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-sm text-muted-foreground">
            Loading your orders…
          </div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load orders:{" "}
            {(query.error as Error)?.message ?? "unknown error"}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-sm text-muted-foreground">
            You have no orders yet.{" "}
            <Link to="/" className="text-primary hover:underline">
              Browse passes and content
            </Link>{" "}
            to get started.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30 text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">What</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Invoice</th>
                  <th className="px-4 py-3">Entitlement</th>
                  <th className="px-4 py-3">Created</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const rowKey = `${r.kind}:${r.id}`;
                  const isOpen = expanded === rowKey;
                  return (
                    <Fragment key={rowKey}>
                      <tr
                        className="cursor-pointer border-t border-border/40 align-top hover:bg-muted/20"
                        onClick={() => setExpanded(isOpen ? null : rowKey)}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium">
                            {KIND_LABEL[r.kind]}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.environment}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {fmtMoney(r.amount_cents, r.currency)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="rounded-md bg-muted/40 px-2 py-0.5 text-foreground/80">
                            {r.invoice_status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span
                            className={`rounded-md px-2 py-0.5 ${STATE_STYLES[r.entitlement_state]}`}
                          >
                            {r.entitlement_state}
                          </span>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {r.entitlement_reason}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          {fmtDate(r.created_at)}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="border-t border-border/20 bg-muted/10">
                          <td colSpan={5} className="px-4 py-4 text-xs text-muted-foreground">
                            <dl className="grid gap-2 sm:grid-cols-2">
                              <div>
                                <dt className="uppercase tracking-widest text-[10px]">Detail</dt>
                                <dd className="mt-1 text-foreground/90">{r.detail}</dd>
                              </div>
                              <div>
                                <dt className="uppercase tracking-widest text-[10px]">
                                  NOWPayments reference
                                </dt>
                                <dd className="mt-1 font-mono text-[11px] text-foreground/80">
                                  {r.payment_reference ?? "— (invoice not yet settled)"}
                                </dd>
                              </div>
                              {r.expires_at ? (
                                <div>
                                  <dt className="uppercase tracking-widest text-[10px]">Expires</dt>
                                  <dd className="mt-1">{fmtDate(r.expires_at)}</dd>
                                </div>
                              ) : null}
                              <div>
                                <dt className="uppercase tracking-widest text-[10px]">Order ID</dt>
                                <dd className="mt-1 font-mono text-[11px]">{r.id}</dd>
                              </div>
                            </dl>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "warn" | "bad";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-400"
      : tone === "warn"
        ? "text-amber-400"
        : tone === "bad"
          ? "text-destructive"
          : "text-foreground";
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}
