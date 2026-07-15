import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listHealthReminderLog } from "@/lib/health-reminder-log.functions";

export const Route = createFileRoute("/_authenticated/admin/health-reminders")({
  head: () => ({
    meta: [
      { title: "Health reminder audit log — Admin" },
      {
        name: "description",
        content:
          "Per-screening audit trail of reminder attempts, delivery status, and timestamps.",
      },
    ],
  }),
  component: AdminHealthRemindersPage,
});

type StatusFilter = "all" | "queued" | "sent" | "failed";
type SinceFilter = "" | "7" | "30" | "90" | "365";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-amber-500/15 text-amber-400",
  sent: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

function AdminHealthRemindersPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [reminderType, setReminderType] = useState<string>("all");
  const [since, setSince] = useState<SinceFilter>("30");
  const [screeningId, setScreeningId] = useState<string>("");

  const fn = useServerFn(listHealthReminderLog);
  const query = useQuery({
    queryKey: [
      "admin-health-reminders",
      status,
      reminderType,
      since,
      screeningId,
    ],
    queryFn: () =>
      fn({
        data: {
          status,
          reminder_type: reminderType,
          since_days: since ? Number(since) : null,
          screening_id: screeningId
            ? screeningId.trim().toLowerCase()
            : null,
          limit: 500,
        },
      }),
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;
  const types = summary?.reminder_types ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
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
          Health reminder audit log
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Every reminder attempt logged per screening — queued, sent, or failed
          — with idempotency keys, channels, timestamps, and errors when
          applicable.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryCard label="Total attempts" value={summary?.total ?? 0} />
          <SummaryCard label="Queued" value={summary?.queued ?? 0} />
          <SummaryCard label="Sent" value={summary?.sent ?? 0} />
          <SummaryCard label="Failed" value={summary?.failed ?? 0} />
        </div>
        {summary?.last_attempt_at && (
          <div className="mt-3 text-xs text-muted-foreground">
            Most recent attempt:{" "}
            {new Date(summary.last_attempt_at).toLocaleString()}
          </div>
        )}
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Status
            </div>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All statuses</option>
              <option value="queued">Queued</option>
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Reminder type
            </div>
            <select
              value={reminderType}
              onChange={(e) => setReminderType(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All types</option>
              {types.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Attempted within
            </div>
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
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Screening ID
            </div>
            <input
              type="search"
              placeholder="uuid…"
              value={screeningId}
              onChange={(e) => setScreeningId(e.target.value)}
              className="w-64 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            />
          </label>
          <div className="ml-auto text-xs text-muted-foreground">
            {query.isLoading ? "Loading…" : `${rows.length} entries`}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        {query.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {query.error instanceof Error
              ? query.error.message
              : "Failed to load reminder log"}
          </div>
        )}
        {!query.isLoading && rows.length === 0 && !query.error && (
          <div className="rounded-lg border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No reminder attempts match the current filter.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Attempted at</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Screening</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Valid until</th>
                  <th className="px-4 py-3">Channels</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => {
                  const channels = Array.isArray(r.channels)
                    ? r.channels.join(", ")
                    : typeof r.channels === "object" && r.channels !== null
                      ? Object.keys(r.channels)
                          .filter((k) => r.channels[k])
                          .join(", ")
                      : String(r.channels ?? "");
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-border/40 align-top"
                    >
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(r.created_at).toLocaleString()}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                            STATUS_STYLES[r.status] ??
                            "bg-muted/40 text-foreground/70"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs">{r.reminder_type}</td>
                      <td className="px-4 py-3 text-xs">
                        <div
                          className="font-mono text-[10px] text-muted-foreground truncate max-w-[18ch]"
                          title={r.screening_id}
                        >
                          {r.screening_id}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div
                          className="font-mono text-[10px] text-muted-foreground truncate max-w-[18ch]"
                          title={r.user_id}
                        >
                          {r.user_id}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {r.valid_until ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {channels || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground max-w-[28ch]">
                        {r.error_message ? (
                          <span
                            className="block truncate text-destructive"
                            title={r.error_message}
                          >
                            {r.error_message}
                          </span>
                        ) : (
                          <span
                            className="block truncate font-mono text-[10px]"
                            title={r.idempotency_key}
                          >
                            {r.idempotency_key}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
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
      <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 font-display text-3xl font-semibold">{value}</div>
    </div>
  );
}
