import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listVenueComplianceReminderLog } from "@/lib/venue-compliance-reminder-log.functions";

export const Route = createFileRoute(
  "/_authenticated/admin/venue-compliance-reminders",
)({
  head: () => ({
    meta: [
      { title: "Venue compliance reminder log — Admin" },
      {
        name: "description",
        content:
          "Audit trail of insurance and permit expiry reminders — recipients, channels, and delivery status.",
      },
    ],
  }),
  component: AdminVenueComplianceRemindersPage,
});

type StatusFilter = "all" | "queued" | "sent" | "failed";
type KindFilter = "all" | "public_liability_insurance" | "event_permit" | "other";
type SinceFilter = "" | "7" | "30" | "90" | "365";

const STATUS_STYLES: Record<string, string> = {
  queued: "bg-amber-500/15 text-amber-400",
  sent: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
};

const KIND_LABELS: Record<string, string> = {
  public_liability_insurance: "Insurance",
  event_permit: "Permit",
  other: "Other",
};

function AdminVenueComplianceRemindersPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [kind, setKind] = useState<KindFilter>("all");
  const [reminderType, setReminderType] = useState<string>("all");
  const [since, setSince] = useState<SinceFilter>("30");
  const [documentId, setDocumentId] = useState<string>("");
  const [recipient, setRecipient] = useState<string>("");

  const fn = useServerFn(listVenueComplianceReminderLog);
  const query = useQuery({
    queryKey: [
      "admin-venue-compliance-reminders",
      status,
      kind,
      reminderType,
      since,
      documentId,
      recipient,
    ],
    queryFn: () =>
      fn({
        data: {
          status,
          kind,
          reminder_type: reminderType,
          since_days: since ? Number(since) : null,
          document_id: documentId ? documentId.trim().toLowerCase() : null,
          recipient: recipient.trim() || null,
          limit: 500,
        },
      }),
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;
  const types = summary?.reminder_types ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
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
          Venue compliance reminder log
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Every insurance certificate and permit expiry reminder — recipients,
          channels, delivery status, timestamps, and errors when applicable.
        </p>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-6">
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

      <section className="mx-auto max-w-6xl px-5 pb-6">
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
          <FilterSelect
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as StatusFilter)}
            options={[
              ["all", "All statuses"],
              ["queued", "Queued"],
              ["sent", "Sent"],
              ["failed", "Failed"],
            ]}
          />
          <FilterSelect
            label="Document kind"
            value={kind}
            onChange={(v) => setKind(v as KindFilter)}
            options={[
              ["all", "All kinds"],
              ["public_liability_insurance", "Insurance"],
              ["event_permit", "Permit"],
              ["other", "Other"],
            ]}
          />
          <FilterSelect
            label="Reminder type"
            value={reminderType}
            onChange={setReminderType}
            options={[
              ["all", "All types"],
              ...types.map((t) => [t, t] as [string, string]),
            ]}
          />
          <FilterSelect
            label="Attempted within"
            value={since}
            onChange={(v) => setSince(v as SinceFilter)}
            options={[
              ["", "All time"],
              ["7", "Last 7 days"],
              ["30", "Last 30 days"],
              ["90", "Last 90 days"],
              ["365", "Last year"],
            ]}
          />
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Recipient
            </div>
            <input
              type="search"
              placeholder="email contains…"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              className="w-56 rounded-md border border-input bg-background px-3 py-2 text-xs"
            />
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
              Document ID
            </div>
            <input
              type="search"
              placeholder="uuid…"
              value={documentId}
              onChange={(e) => setDocumentId(e.target.value)}
              className="w-64 rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
            />
          </label>
          <div className="ml-auto text-xs text-muted-foreground">
            {query.isLoading ? "Loading…" : `${rows.length} entries`}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
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
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Attempted at</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Document</th>
                  <th className="px-4 py-3">Expires</th>
                  <th className="px-4 py-3">Recipients</th>
                  <th className="px-4 py-3">Channels</th>
                  <th className="px-4 py-3">Details</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const channels = Array.isArray(r.channels)
                    ? r.channels.join(", ")
                    : "";
                  const recipients = r.recipient_list ?? [];
                  const docLabel =
                    r.document?.title ||
                    r.document?.venue_name ||
                    r.document_id;
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
                      <td className="px-4 py-3 text-xs">
                        <div>{KIND_LABELS[r.kind] ?? r.kind}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {r.reminder_type}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="truncate max-w-[24ch]" title={docLabel}>
                          {docLabel}
                        </div>
                        <div
                          className="font-mono text-[10px] text-muted-foreground truncate max-w-[24ch]"
                          title={r.document_id}
                        >
                          {r.document_id}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {r.expires_on ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {recipients.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {recipients.map((email, i) => (
                              <li
                                key={`${r.id}-${i}`}
                                className="truncate max-w-[26ch]"
                                title={email}
                              >
                                {email}
                              </li>
                            ))}
                          </ul>
                        )}
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

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label className="block text-xs">
      <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-input bg-background px-3 py-2 text-sm"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}
