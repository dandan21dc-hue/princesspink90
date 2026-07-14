import { Fragment, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  listAdminOrders,
  type AdminOrderRow,
} from "@/lib/admin-orders.functions";

export const Route = createFileRoute("/_authenticated/admin/orders-status")({
  head: () => ({
    meta: [
      { title: "Order payment status — Admin" },
      {
        name: "description",
        content:
          "Every order, subscription, purchase and booking with its current payment status, last webhook event, and entitlement state.",
      },
    ],
  }),
  component: AdminOrdersStatusPage,
});

type KindFilter = "all" | "panty" | "subscription" | "content" | "booking";
type EnvFilter = "all" | "sandbox" | "live";

const ENTITLEMENT_STYLES: Record<AdminOrderRow["entitlement_state"], string> = {
  granted: "bg-emerald-500/15 text-emerald-400",
  pending: "bg-amber-500/15 text-amber-400",
  revoked: "bg-destructive/15 text-destructive",
};

const KIND_LABEL: Record<AdminOrderRow["kind"], string> = {
  panty: "Panty order",
  subscription: "Subscription",
  content: "Content purchase",
  booking: "Room booking",
};

function fmtMoney(cents: number | null, currency: string | null) {
  if (cents == null) return "—";
  const value = cents / 100;
  const c = (currency ?? "aud").toUpperCase();
  return `${c} ${value.toFixed(2)}`;
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function AdminOrdersStatusPage() {
  const [kind, setKind] = useState<KindFilter>("all");
  const [environment, setEnvironment] = useState<EnvFilter>("all");
  const [expanded, setExpanded] = useState<string | null>(null);

  const fn = useServerFn(listAdminOrders);
  const query = useQuery({
    queryKey: ["admin-orders-status", kind, environment],
    queryFn: () => fn({ data: { kind, environment, limit: 100 } }),
    refetchInterval: 30_000,
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;

  const counts = useMemo(
    () => summary ?? { total: 0, granted: 0, pending: 0, revoked: 0 },
    [summary],
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-6xl px-5 pt-16 pb-8">
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">
          Admin
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold">
          Order payment status
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Cross-checks every order, subscription, one-time purchase and room
          booking against its most recent Stripe webhook event. Use it to verify
          that pending payments stay non-entitled until Stripe confirms them.
        </p>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Total" value={counts.total} />
          <SummaryCard label="Granted" value={counts.granted} tone="ok" />
          <SummaryCard label="Pending" value={counts.pending} tone="warn" />
          <SummaryCard label="Revoked" value={counts.revoked} tone="bad" />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-6">
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
          <Field label="Kind">
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as KindFilter)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="panty">Panty orders</option>
              <option value="subscription">Subscriptions</option>
              <option value="content">Content purchases</option>
              <option value="booking">Room bookings</option>
            </select>
          </Field>
          <Field label="Environment">
            <select
              value={environment}
              onChange={(e) => setEnvironment(e.target.value as EnvFilter)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="sandbox">Sandbox</option>
              <option value="live">Live</option>
            </select>
          </Field>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-xs font-medium uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            Refresh
          </button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        {query.isLoading ? (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-sm text-muted-foreground">
            Loading orders…
          </div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load orders:{" "}
            {(query.error as Error)?.message ?? "unknown error"}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-sm text-muted-foreground">
            No orders match the current filters.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/30 text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Detail</th>
                  <th className="px-4 py-3">Amount</th>
                  <th className="px-4 py-3">Payment status</th>
                  <th className="px-4 py-3">Entitlement</th>
                  <th className="px-4 py-3">Last webhook</th>
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
                          <div className="font-medium">{KIND_LABEL[r.kind]}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {r.environment}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">
                          <div className="max-w-xs truncate" title={r.detail}>
                            {r.detail}
                          </div>
                          {r.reference_id ? (
                            <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">
                              {r.reference_id}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {fmtMoney(r.amount_cents, r.currency)}
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span className="rounded-md bg-muted/40 px-2 py-0.5 text-foreground/80">
                            {r.payment_status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          <span
                            className={`rounded-md px-2 py-0.5 ${ENTITLEMENT_STYLES[r.entitlement_state]}`}
                          >
                            {r.entitlement_state}
                          </span>
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {r.entitlement_reason}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs">
                          {r.last_webhook ? (
                            <>
                              <div className="font-mono text-[11px]">
                                {r.last_webhook.event_type}
                              </div>
                              <div className="text-[11px] text-muted-foreground">
                                {r.last_webhook.status} ·{" "}
                                {fmtDate(r.last_webhook.received_at)}
                              </div>
                              {r.last_webhook.error_message ? (
                                <div className="mt-1 text-[11px] text-destructive">
                                  {r.last_webhook.error_message}
                                </div>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-muted-foreground">
                              None recorded
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[11px] text-muted-foreground">
                          {fmtDate(r.created_at)}
                        </td>
                      </tr>
                      {isOpen ? (
                        <tr className="border-t border-border/40 bg-muted/10">
                          <td colSpan={7} className="px-4 py-3">
                            <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-2">
                              <div>
                                <div className="uppercase tracking-widest text-muted-foreground/70">
                                  Order id
                                </div>
                                <div className="font-mono text-foreground/80">
                                  {r.id}
                                </div>
                              </div>
                              <div>
                                <div className="uppercase tracking-widest text-muted-foreground/70">
                                  User
                                </div>
                                <div className="font-mono text-foreground/80">
                                  {r.user_id ?? "—"}
                                </div>
                              </div>
                              <div>
                                <div className="uppercase tracking-widest text-muted-foreground/70">
                                  Updated
                                </div>
                                <div>{fmtDate(r.updated_at)}</div>
                              </div>
                              <div>
                                <div className="uppercase tracking-widest text-muted-foreground/70">
                                  Stripe reference
                                </div>
                                <div className="font-mono text-foreground/80">
                                  {r.reference_id ?? "—"}
                                </div>
                              </div>
                            </div>
                            <div className="mt-3">
                              <Link
                                to="/admin/webhook-events"
                                className="text-[11px] uppercase tracking-widest text-primary hover:underline"
                              >
                                Open webhook events log →
                              </Link>
                            </div>
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
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-display text-3xl font-semibold ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-muted-foreground">
      {label}
      {children}
    </label>
  );
}
