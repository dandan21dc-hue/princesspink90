import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import {
  getCheckoutReconciliation,
  type ReconciliationStatus,
} from "@/lib/analytics.functions";

export const Route = createFileRoute(
  "/_authenticated/admin/checkout-reconciliation",
)({
  head: () => ({
    meta: [
      { title: "Checkout reconciliation — Admin" },
      {
        name: "description",
        content:
          "Look up every persisted checkout tracking event for a given client_order_ref and see start/confirmed/pending/cancelled coverage.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CheckoutReconciliationPage,
});

// Loose UUID / hex-ish shape — matches the server-side inputValidator so
// the user sees a client-side format hint before the request goes out.
const CLIENT_ORDER_REF_RE = /^[0-9a-fA-F-]{8,64}$/;

function CheckoutReconciliationPage() {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);
  const fn = useServerFn(getCheckoutReconciliation);

  const q = useQuery({
    queryKey: ["checkout-reconciliation", submitted],
    queryFn: () => fn({ data: { clientOrderRef: submitted! } }),
    enabled: !!submitted,
    retry: false,
  });

  const inputLooksValid = CLIENT_ORDER_REF_RE.test(input.trim());

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Checkout reconciliation</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Paste a{" "}
          <code className="rounded bg-muted px-1">client_order_ref</code> (the
          UUID minted by the cart drawer at
          <code className="mx-1">panty_checkout_start</code>) to see every
          persisted tracking event for that checkout and confirm which funnel
          stages fired.
        </p>
      </div>

      <form
        className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          const trimmed = input.trim();
          if (CLIENT_ORDER_REF_RE.test(trimmed)) setSubmitted(trimmed);
        }}
      >
        <label className="flex-1 text-xs uppercase tracking-widest text-muted-foreground">
          client_order_ref
          <input
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-sm text-foreground"
            placeholder="e.g. 11111111-1111-1111-1111-111111111111"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-invalid={input.length > 0 && !inputLooksValid}
          />
        </label>
        <button
          type="submit"
          disabled={!inputLooksValid}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          Look up
        </button>
      </form>

      {q.isLoading && (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
      {q.error && (
        <p className="text-sm text-destructive">
          {(q.error as Error).message}
        </p>
      )}

      {q.data && (
        <>
          <StatusMatrix status={q.data.status} />

          <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Meta label="Total events" value={q.data.total_events.toString()} />
            <Meta
              label="Stripe sessions"
              value={q.data.session_ids.length.toString()}
              detail={q.data.session_ids.join(", ") || "—"}
            />
            <Meta
              label="Order IDs"
              value={q.data.order_ids.length.toString()}
              detail={q.data.order_ids.join(", ") || "—"}
            />
          </div>

          <h2 className="mb-2 mt-8 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Event timeline
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Session</th>
                  <th className="px-3 py-2">Reason / status</th>
                  <th className="px-3 py-2">Order IDs</th>
                </tr>
              </thead>
              <tbody>
                {q.data.events.length === 0 && (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      No persisted events for this client_order_ref.
                    </td>
                  </tr>
                )}
                {q.data.events.map((e) => (
                  <tr key={e.id} className="border-t border-border align-top">
                    <td className="px-3 py-2 font-mono whitespace-nowrap">
                      {new Date(e.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2 font-mono">{e.event}</td>
                    <td className="px-3 py-2 font-mono">
                      {String(e.props.session_id ?? e.session_id ?? "—")}
                    </td>
                    <td className="px-3 py-2">
                      {[e.props.status, e.props.reason]
                        .filter(Boolean)
                        .join(" / ") || "—"}
                    </td>
                    <td className="px-3 py-2 font-mono">
                      {String(e.props.order_ids ?? e.props.order_id ?? "—")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * The reconciliation matrix at a glance — one row per funnel stage with a
 * ✓ / ✗ pill so an admin can spot missing events immediately.
 */
function StatusMatrix({
  status,
}: {
  status: Record<
    | "start"
    | "confirmed"
    | "pending"
    | "cancelled"
    | "return_failed"
    | "checkout_completed",
    ReconciliationStatus
  >;
}) {
  const rows: Array<{
    key: keyof typeof status;
    label: string;
    hint: string;
  }> = [
    { key: "start", label: "start", hint: "panty_checkout_start(ed)" },
    { key: "confirmed", label: "confirmed", hint: "panty_checkout_confirmed" },
    { key: "pending", label: "pending", hint: "panty_checkout_pending" },
    { key: "cancelled", label: "cancelled", hint: "panty_checkout_cancelled" },
    {
      key: "return_failed",
      label: "return failed",
      hint: "stripe_checkout_return_failed",
    },
    {
      key: "checkout_completed",
      label: "attribution",
      hint: "checkout_completed",
    },
  ];

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead className="bg-muted/40 text-left text-xs uppercase tracking-widest text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Stage</th>
            <th className="px-3 py-2">Event</th>
            <th className="px-3 py-2 text-right">Seen</th>
            <th className="px-3 py-2 text-right">Count</th>
            <th className="px-3 py-2">First</th>
            <th className="px-3 py-2">Last</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = status[r.key];
            return (
              <tr key={r.key} className="border-t border-border">
                <td className="px-3 py-2 font-medium capitalize">{r.label}</td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {r.hint}
                </td>
                <td className="px-3 py-2 text-right">
                  <span
                    className={[
                      "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest",
                      s.seen
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground",
                    ].join(" ")}
                  >
                    {s.seen ? "yes" : "no"}
                  </span>
                </td>
                <td className="px-3 py-2 text-right font-mono">{s.count}</td>
                <td className="px-3 py-2 font-mono text-xs">
                  {s.first_at ? new Date(s.first_at).toLocaleString() : "—"}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  {s.last_at ? new Date(s.last_at).toLocaleString() : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Meta({
  label,
  value,
  detail,
}: {
  label: string;
  value: string;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
      {detail && (
        <div className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {detail}
        </div>
      )}
    </div>
  );
}
