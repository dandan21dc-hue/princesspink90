import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listHealthPurgeLog } from "@/lib/health-purge.functions";

export const Route = createFileRoute("/_authenticated/admin/health-purge")({
  head: () => ({
    meta: [
      { title: "Health screenings purge log — Admin" },
      { name: "description", content: "Audit trail of purged health screening records with filters and status summary." },
    ],
  }),
  component: AdminHealthPurgePage,
});

type ReasonFilter = "all" | "expired_validity" | "rejected_retention_expired" | "pending_stale";
type StatusFilter = "all" | "pending" | "approved" | "rejected";
type SinceFilter = "" | "7" | "30" | "90" | "365";

const REASON_LABEL: Record<string, string> = {
  expired_validity: "Expired validity",
  rejected_retention_expired: "Rejected · retention expired",
  pending_stale: "Pending · stale",
};

function AdminHealthPurgePage() {
  const [reason, setReason] = useState<ReasonFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [since, setSince] = useState<SinceFilter>("30");

  const fn = useServerFn(listHealthPurgeLog);
  const query = useQuery({
    queryKey: ["admin-health-purge", reason, status, since],
    queryFn: () =>
      fn({
        data: {
          reason,
          status,
          since_days: since ? Number(since) : null,
          limit: 500,
        },
      }),
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
        <h1 className="mt-2 font-display text-3xl font-semibold">Health screenings purge log</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Every health screening record that has been automatically purged — the
          underlying file is removed, and this log preserves who, when, and why.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Total purges" value={summary?.total ?? 0} />
          <SummaryCard label="Expired validity" value={summary?.by_reason.expired_validity ?? 0} />
          <SummaryCard label="Rejected · retention" value={summary?.by_reason.rejected_retention_expired ?? 0} />
          <SummaryCard label="Pending · stale" value={summary?.by_reason.pending_stale ?? 0} />
        </div>
        {summary?.last_purge_at && (
          <div className="mt-3 text-xs text-muted-foreground">
            Most recent purge: {new Date(summary.last_purge_at).toLocaleString()}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">Reason</div>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReasonFilter)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All reasons</option>
              <option value="expired_validity">Expired validity</option>
              <option value="rejected_retention_expired">Rejected · retention expired</option>
              <option value="pending_stale">Pending · stale</option>
            </select>
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">Original status</div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">Purged within</div>
            <select
              value={since}
              onChange={(e) => setSince(e.target.value as SinceFilter)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All time</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </label>
          <div className="ml-auto text-xs text-muted-foreground">
            {query.isLoading ? "Loading…" : `${rows.length} entries`}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        {query.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {query.error instanceof Error ? query.error.message : "Failed to load purge log"}
          </div>
        )}
        {!query.isLoading && rows.length === 0 && !query.error && (
          <div className="rounded-lg border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No purge entries match the current filter.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Purged at</th>
                  <th className="px-4 py-3">Reason</th>
                  <th className="px-4 py-3">Original status</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Test date</th>
                  <th className="px-4 py-3">Valid until</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/40 align-top">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.purged_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                          r.reason === "expired_validity"
                            ? "bg-amber-500/15 text-amber-400"
                            : r.reason === "rejected_retention_expired"
                            ? "bg-destructive/15 text-destructive"
                            : "bg-muted/40 text-foreground/70"
                        }`}
                      >
                        {REASON_LABEL[r.reason] ?? r.reason}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.status ?? "—"}</td>
                    <td className="px-4 py-3 text-xs">
                      <div className="text-[10px] text-muted-foreground truncate max-w-[20ch]" title={r.user_id}>
                        {r.user_id}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {r.test_date ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {r.valid_until ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</div>
      <div className="mt-2 font-display text-3xl font-semibold">{value}</div>
    </div>
  );
}
