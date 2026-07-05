import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listEmailSendLog } from "@/lib/email-send-log.functions";

export const Route = createFileRoute("/_authenticated/admin/email-delivery")({
  head: () => ({
    meta: [
      { title: "Email delivery status — Admin" },
      {
        name: "description",
        content:
          "Per-email send results, errors, and timestamps sourced from the email send log.",
      },
    ],
  }),
  component: AdminEmailDeliveryPage,
});

type StatusFilter =
  | "all"
  | "pending"
  | "sent"
  | "suppressed"
  | "failed"
  | "bounced"
  | "complained"
  | "dlq";
type SinceFilter = "" | "1" | "7" | "30" | "90" | "365";

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-400",
  sent: "bg-emerald-500/15 text-emerald-400",
  suppressed: "bg-muted/40 text-foreground/70",
  failed: "bg-destructive/15 text-destructive",
  dlq: "bg-destructive/15 text-destructive",
  bounced: "bg-destructive/15 text-destructive",
  complained: "bg-destructive/15 text-destructive",
};

function AdminEmailDeliveryPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [templateName, setTemplateName] = useState<string>("all");
  const [since, setSince] = useState<SinceFilter>("7");
  const [recipient, setRecipient] = useState<string>("");

  const fn = useServerFn(listEmailSendLog);
  const query = useQuery({
    queryKey: ["admin-email-delivery", status, templateName, since, recipient],
    queryFn: () =>
      fn({
        data: {
          status,
          template_name: templateName,
          since_days: since ? Number(since) : null,
          recipient: recipient.trim() ? recipient.trim() : null,
          limit: 500,
        },
      }),
    refetchInterval: 30_000,
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;
  const templates = summary?.templates ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground">
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
          Email delivery status
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Send results, errors, and timestamps for every reminder and
          transactional email. Deduplicated to the latest status per message.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Unique emails" value={summary?.total ?? 0} />
          <SummaryCard label="Sent" value={summary?.sent ?? 0} />
          <SummaryCard label="Failed" value={summary?.failed ?? 0} />
          <SummaryCard label="Suppressed" value={summary?.suppressed ?? 0} />
          <SummaryCard label="Pending" value={summary?.pending ?? 0} />
        </div>
        {summary?.last_sent_at && (
          <div className="mt-3 text-xs text-muted-foreground">
            Most recent successful send:{" "}
            {new Date(summary.last_sent_at).toLocaleString()}
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
              <option value="sent">Sent</option>
              <option value="failed">Failed</option>
              <option value="dlq">DLQ</option>
              <option value="bounced">Bounced</option>
              <option value="complained">Complained</option>
              <option value="suppressed">Suppressed</option>
              <option value="pending">Pending</option>
            </select>
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Template
            </div>
            <select
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All templates</option>
              {templates.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Sent within
            </div>
            <select
              value={since}
              onChange={(e) => setSince(e.target.value as SinceFilter)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All time</option>
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="365">Last year</option>
            </select>
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Recipient
            </div>
            <input
              type="search"
              placeholder="email contains…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-64 rounded-md border border-input bg-background px-3 py-2 text-xs"
            />
          </label>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <button
              type="button"
              onClick={() => query.refetch()}
              className="rounded-md border border-input bg-background px-3 py-2 hover:bg-muted/50"
            >
              Refresh
            </button>
            <span>
              {query.isLoading ? "Loading…" : `${rows.length} entries`}
            </span>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        {query.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {query.error instanceof Error
              ? query.error.message
              : "Failed to load email send log"}
          </div>
        )}
        {!query.isLoading && rows.length === 0 && !query.error && (
          <div className="rounded-lg border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No emails match the current filter.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60">
            <table className="w-full min-w-[880px] text-sm">
              <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Sent at</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Template</th>
                  <th className="px-4 py-3">Recipient</th>
                  <th className="px-4 py-3">Message ID</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r: any) => (
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
                    <td className="px-4 py-3 text-xs">{r.template_name}</td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className="block truncate max-w-[24ch]"
                        title={r.recipient_email}
                      >
                        {r.recipient_email}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span
                        className="block truncate font-mono text-[10px] text-muted-foreground max-w-[22ch]"
                        title={r.message_id ?? ""}
                      >
                        {r.message_id ?? "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground max-w-[32ch]">
                      {r.error_message ? (
                        <span
                          className="block truncate text-destructive"
                          title={r.error_message}
                        >
                          {r.error_message}
                        </span>
                      ) : r.metadata ? (
                        <span
                          className="block truncate font-mono text-[10px]"
                          title={JSON.stringify(r.metadata)}
                        >
                          {JSON.stringify(r.metadata)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
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
