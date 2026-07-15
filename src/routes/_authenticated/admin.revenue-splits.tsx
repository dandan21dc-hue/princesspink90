import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { amIAdmin } from "@/lib/admin.functions";
import {
  createRevenueSplit,
  deleteRevenueSplit,
  listEventsForSplits,
  listRevenueSplits,
  markRevenueSplitPaid,
} from "@/lib/revenue-splits.functions";

export const Route = createFileRoute("/_authenticated/admin/revenue-splits")({
  head: () => ({ meta: [{ title: "Revenue splits · Admin" }] }),
  component: AdminRevenueSplits,
});

const AUD = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });

function fmtMoney(cents: number) {
  return AUD.format((cents ?? 0) / 100);
}
function fmtDate(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

type Split = {
  id: string;
  event_id: string;
  cohost_user_id: string;
  total_revenue_cents: number;
  partner_share_percent: number;
  status: "pending" | "paid";
  paid_at: string | null;
  paid_by: string | null;
  notes: string | null;
  created_at: string;
  events?: { id: string; title: string; starts_at: string } | null;
};

function AdminRevenueSplits() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(listRevenueSplits);
  const eventsFn = useServerFn(listEventsForSplits);
  const createFn = useServerFn(createRevenueSplit);
  const payFn = useServerFn(markRevenueSplitPaid);
  const delFn = useServerFn(deleteRevenueSplit);
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const splits = useQuery<Split[]>({
    queryKey: ["admin-revenue-splits"],
    queryFn: () => listFn() as any,
    enabled: me.data?.isAdmin === true,
  });
  const events = useQuery({
    queryKey: ["admin-revenue-splits-events"],
    queryFn: () => eventsFn(),
    enabled: me.data?.isAdmin === true,
  });

  const totals = useMemo(() => {
    const rows = splits.data ?? [];
    let revenue = 0, partner = 0, house = 0, pending = 0, paid = 0;
    for (const r of rows) {
      const share = Math.round((r.total_revenue_cents * Number(r.partner_share_percent)) / 100);
      revenue += r.total_revenue_cents;
      partner += share;
      house += r.total_revenue_cents - share;
      if (r.status === "paid") paid += share; else pending += share;
    }
    return { revenue, partner, house, pending, paid };
  }, [splits.data]);

  const pay = useMutation({
    mutationFn: (id: string) => payFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Marked as paid");
      qc.invalidateQueries({ queryKey: ["admin-revenue-splits"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const del = useMutation({
    mutationFn: (id: string) => delFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-revenue-splits"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  if (me.isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don't have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">Back to dashboard</Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="text-2xl font-serif">Revenue splits</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Log event revenue and partner share, then mark payouts as paid.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <Stat label="Total revenue" value={fmtMoney(totals.revenue)} tone="neutral" />
        <Stat label="Partner share" value={fmtMoney(totals.partner)} tone="accent" />
        <Stat label="House share" value={fmtMoney(totals.house)} tone="neutral" />
        <Stat label="Pending payout" value={fmtMoney(totals.pending)} tone="pending" />
        <Stat label="Paid out" value={fmtMoney(totals.paid)} tone="paid" />
      </div>

      <CreateForm
        events={(events.data as any[]) ?? []}
        onSubmit={async (payload) => {
          try {
            await createFn({ data: payload });
            toast.success("Split created");
            qc.invalidateQueries({ queryKey: ["admin-revenue-splits"] });
          } catch (e: any) {
            toast.error(e?.message ?? "Failed to create");
          }
        }}
      />

      <div className="mt-8">
        {splits.isLoading ? (
          <p className="text-muted-foreground">Loading splits…</p>
        ) : (splits.data?.length ?? 0) === 0 ? (
          <p className="text-muted-foreground">No revenue splits yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-secondary/40 text-left text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Co-host</th>
                  <th className="px-3 py-2 text-right">Total revenue</th>
                  <th className="px-3 py-2 text-right">Split</th>
                  <th className="px-3 py-2 text-right">Partner share</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Paid at</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(splits.data ?? []).map((r) => {
                  const share = Math.round((r.total_revenue_cents * Number(r.partner_share_percent)) / 100);
                  return (
                    <tr key={r.id} className="border-t border-border/60">
                      <td className="px-3 py-2">
                        <div className="font-medium">{r.events?.title ?? "—"}</div>
                        <div className="text-xs text-muted-foreground">{fmtDate(r.events?.starts_at ?? null)}</div>
                      </td>
                      <td className="px-3 py-2 font-mono text-xs">{r.cohost_user_id.slice(0, 8)}…</td>
                      <td className="px-3 py-2 text-right">{fmtMoney(r.total_revenue_cents)}</td>
                      <td className="px-3 py-2 text-right">{Number(r.partner_share_percent).toFixed(2)}%</td>
                      <td className="px-3 py-2 text-right font-medium">{fmtMoney(share)}</td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            "inline-flex items-center rounded-full px-2 py-0.5 text-xs " +
                            (r.status === "paid"
                              ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30"
                              : "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30")
                          }
                        >
                          {r.status === "paid" ? "Paid" : "Pending"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(r.paid_at)}</td>
                      <td className="px-3 py-2 text-right space-x-2 whitespace-nowrap">
                        {r.status === "pending" && (
                          <button
                            type="button"
                            disabled={pay.isPending}
                            onClick={() => pay.mutate(r.id)}
                            className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs text-primary hover:bg-primary/20 disabled:opacity-50"
                          >
                            Mark as paid
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={del.isPending}
                          onClick={() => {
                            if (confirm("Delete this revenue split?")) del.mutate(r.id);
                          }}
                          className="rounded-md border border-border/60 px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary/50 disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}

function CreateForm({
  events,
  onSubmit,
}: {
  events: { id: string; title: string; starts_at: string }[];
  onSubmit: (data: {
    event_id: string;
    cohost_user_id: string;
    total_revenue_cents: number;
    partner_share_percent: number;
    notes: string | null;
  }) => Promise<void>;
}) {
  const [eventId, setEventId] = useState("");
  const [cohostId, setCohostId] = useState("");
  const [totalDollars, setTotalDollars] = useState("");
  const [pct, setPct] = useState("50");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  const totalCents = Math.round((parseFloat(totalDollars) || 0) * 100);
  const share = Math.round((totalCents * (parseFloat(pct) || 0)) / 100);
  const house = totalCents - share;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!eventId || !cohostId || totalCents < 0) {
          toast.error("Fill in event, co-host user id and revenue");
          return;
        }
        setBusy(true);
        try {
          await onSubmit({
            event_id: eventId,
            cohost_user_id: cohostId,
            total_revenue_cents: totalCents,
            partner_share_percent: parseFloat(pct) || 0,
            notes: notes.trim() ? notes.trim() : null,
          });
          setTotalDollars("");
          setCohostId("");
          setNotes("");
        } finally {
          setBusy(false);
        }
      }}
      className="rounded-lg border border-border/60 bg-card/40 p-4 space-y-3"
    >
      <h2 className="text-sm font-medium uppercase tracking-widest text-muted-foreground">
        New revenue split
      </h2>
      <div className="grid md:grid-cols-2 gap-3">
        <label className="text-sm">
          <div className="mb-1 text-xs text-muted-foreground">Event</div>
          <select
            value={eventId}
            onChange={(e) => setEventId(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5"
          >
            <option value="">Select event…</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title} — {new Date(e.starts_at).toLocaleDateString()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <div className="mb-1 text-xs text-muted-foreground">Co-host user id (UUID)</div>
          <input
            value={cohostId}
            onChange={(e) => setCohostId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-xs text-muted-foreground">Total event revenue (AUD)</div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={totalDollars}
            onChange={(e) => setTotalDollars(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5"
          />
        </label>
        <label className="text-sm">
          <div className="mb-1 text-xs text-muted-foreground">Partner share (%)</div>
          <input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
            className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5"
          />
        </label>
        <label className="text-sm md:col-span-2">
          <div className="mb-1 text-xs text-muted-foreground">Notes (optional)</div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded-md border border-border/60 bg-background px-2 py-1.5"
          />
        </label>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <Stat label="Total" value={AUD.format(totalCents / 100)} tone="neutral" />
        <Stat label={`Partner ${pct || 0}%`} value={AUD.format(share / 100)} tone="accent" />
        <Stat label="House" value={AUD.format(house / 100)} tone="neutral" />
      </div>

      <button
        type="submit"
        disabled={busy}
        className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {busy ? "Saving…" : "Create split"}
      </button>
    </form>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-6xl px-5 py-12">{children}</section>;
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "accent" | "pending" | "paid";
}) {
  const toneCls =
    tone === "accent"
      ? "border-primary/40 bg-primary/10 text-primary"
      : tone === "pending"
      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
      : tone === "paid"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
      : "border-border/60 bg-secondary/30 text-muted-foreground";
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-0.5 text-sm font-medium">{value}</div>
    </div>
  );
}
