import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  listStripeWebhookEvents,
  replayStripeWebhookEvent,
  type StripeWebhookEventRow,
} from "@/lib/stripe-webhook-events.functions";


export const Route = createFileRoute("/_authenticated/admin/webhook-events")({
  head: () => ({
    meta: [
      { title: "Stripe webhook events — Admin" },
      {
        name: "description",
        content:
          "Audit every incoming Stripe webhook: raw payload, processing status, timing, and errors.",
      },
    ],
  }),
  component: AdminWebhookEventsPage,
});

type StatusFilter =
  | "all"
  | "received"
  | "processing"
  | "succeeded"
  | "failed"
  | "ignored";
type EnvFilter = "all" | "sandbox" | "live";

const STATUS_STYLES: Record<string, string> = {
  received: "bg-muted/40 text-foreground/70",
  processing: "bg-amber-500/15 text-amber-400",
  succeeded: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
  ignored: "bg-muted/40 text-foreground/60",
};

function AdminWebhookEventsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [environment, setEnvironment] = useState<EnvFilter>("all");
  const [eventType, setEventType] = useState<string>("all");
  const [sinceDays, setSinceDays] = useState<string>("7");
  const [search, setSearch] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const fn = useServerFn(listStripeWebhookEvents);
  const query = useQuery({
    queryKey: [
      "admin-stripe-webhook-events",
      status,
      environment,
      eventType,
      sinceDays,
      search,
    ],
    queryFn: () =>
      fn({
        data: {
          status,
          environment,
          event_type: eventType,
          since_days: sinceDays ? Number(sinceDays) : null,
          search: search.trim() ? search.trim() : null,
          limit: 200,
        },
      }),
    refetchInterval: 30_000,
  });

  const rows = query.data?.rows ?? [];
  const summary = query.data?.summary;
  const eventTypes = query.data?.eventTypes ?? [];

  const counts = useMemo(
    () =>
      summary?.counts ?? {
        received: 0,
        processing: 0,
        succeeded: 0,
        failed: 0,
        ignored: 0,
      },
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
          Stripe webhook events
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Every incoming Stripe webhook is recorded here with its raw payload,
          processing status, and any error. Use this to audit subscription and
          membership creation end-to-end.
        </p>
      </header>

      <section className="mx-auto max-w-6xl px-5 pb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <SummaryCard label="Succeeded" value={counts.succeeded ?? 0} />
          <SummaryCard label="Failed" value={counts.failed ?? 0} />
          <SummaryCard label="Ignored" value={counts.ignored ?? 0} />
          <SummaryCard label="Processing" value={counts.processing ?? 0} />
          <SummaryCard label="Total" value={summary?.total ?? 0} />
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-6">
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
          <Field label="Status">
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              <option value="succeeded">Succeeded</option>
              <option value="failed">Failed</option>
              <option value="ignored">Ignored</option>
              <option value="processing">Processing</option>
              <option value="received">Received</option>
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
          <Field label="Event type">
            <select
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All</option>
              {eventTypes.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Since">
            <select
              value={sinceDays}
              onChange={(e) => setSinceDays(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="1">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="">All time</option>
            </select>
          </Field>
          <Field label="Search (event id / error)">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="evt_… or error text"
              className="w-64 rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
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
            Loading webhook events…
          </div>
        ) : query.isError ? (
          <div className="rounded-2xl border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load webhook events:{" "}
            {query.error instanceof Error
              ? query.error.message
              : "unknown error"}
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border border-border/60 bg-card/60 p-8 text-sm text-muted-foreground">
            No webhook events match those filters yet.
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-border/60 bg-card/60">
            <ul className="divide-y divide-border/60">
              {rows.map((row) => (
                <EventRow
                  key={row.id}
                  row={row}
                  expanded={expanded === row.id}
                  onToggle={() =>
                    setExpanded((cur) => (cur === row.id ? null : row.id))
                  }
                />
              ))}
            </ul>
          </div>
        )}
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-card/60 p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-display text-2xl font-semibold">
        {value.toLocaleString()}
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
    <label className="block text-xs">
      <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      {children}
    </label>
  );
}

function EventRow({
  row,
  expanded,
  onToggle,
}: {
  row: StripeWebhookEventRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const statusClass =
    STATUS_STYLES[row.status] ?? "bg-muted/40 text-foreground/70";
  const qc = useQueryClient();
  const replayFn = useServerFn(replayStripeWebhookEvent);
  const replay = useMutation({
    mutationFn: () => replayFn({ data: { id: row.id } }),
    onSettled: () =>
      qc.invalidateQueries({ queryKey: ["admin-stripe-webhook-events"] }),
  });
  const isReplay = !!row.replay_of_event_id;
  const canReplay =
    !!row.raw_payload &&
    typeof row.raw_payload === "object" &&
    typeof (row.raw_payload as any).type === "string" &&
    !!(row.raw_payload as any).data;

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full flex-col gap-2 px-4 py-3 text-left transition hover:bg-muted/30 sm:flex-row sm:items-center sm:gap-4"
      >
        <span
          className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${statusClass}`}
        >
          {row.status}
        </span>
        <span className="font-mono text-xs sm:w-56 sm:truncate">
          {row.event_type}
          {isReplay ? (
            <span className="ml-2 rounded bg-primary/15 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-primary">
              replay
            </span>
          ) : null}
        </span>
        <span className="text-xs text-muted-foreground sm:w-20">
          {row.environment}
        </span>
        <span className="flex-1 truncate font-mono text-[11px] text-muted-foreground">
          {row.stripe_event_id ?? "—"}
        </span>
        <span className="text-xs text-muted-foreground sm:w-40">
          {new Date(row.received_at).toLocaleString()}
        </span>
        <span className="text-xs text-muted-foreground sm:w-16 sm:text-right">
          {row.processing_ms != null ? `${row.processing_ms} ms` : "—"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border/60 bg-background/40 px-4 py-4 text-xs">
          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <MetaField
              label="Correlation ID"
              value={row.correlation_id}
              mono
              copyable
            />
            <MetaField
              label={isReplay ? "Replay of event row" : "Replayed at"}
              value={
                isReplay
                  ? (row.replay_of_event_id ?? "—")
                  : row.replayed_at
                    ? new Date(row.replayed_at).toLocaleString()
                    : "Never"
              }
              mono={isReplay}
            />
          </div>
          {row.error_message && (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
              <div className="font-semibold uppercase tracking-widest text-[10px]">
                Error
              </div>
              <div className="mt-1 whitespace-pre-wrap">{row.error_message}</div>
            </div>
          )}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border/60 bg-card/40 p-3">
            <div className="flex-1 text-[11px] text-muted-foreground">
              Manually re-dispatch this stored payload to test the pending →
              confirmed transition. A new event row is inserted (linked to
              this one) with a fresh correlation ID.
            </div>
            <button
              type="button"
              disabled={!canReplay || replay.isPending}
              onClick={() => replay.mutate()}
              className="rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-[11px] font-medium uppercase tracking-widest text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {replay.isPending ? "Replaying…" : "Replay event"}
            </button>
          </div>
          {replay.data ? (
            <div
              className={`mb-3 rounded-md border p-3 text-[11px] ${
                replay.data.ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
                  : "border-destructive/40 bg-destructive/10 text-destructive"
              }`}
            >
              <div className="font-semibold uppercase tracking-widest">
                Replay {replay.data.ok ? "dispatched" : "failed"} ·{" "}
                {replay.data.status} · {replay.data.processing_ms} ms
              </div>
              <div className="mt-1 font-mono">
                cid: {replay.data.correlation_id}
              </div>
              {replay.data.note ? (
                <div className="mt-1 whitespace-pre-wrap">
                  {replay.data.note}
                </div>
              ) : null}
            </div>
          ) : null}
          {replay.error ? (
            <div className="mb-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-[11px] text-destructive">
              Replay error:{" "}
              {replay.error instanceof Error
                ? replay.error.message
                : "unknown error"}
            </div>
          ) : null}
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Raw payload
            </span>
            <button
              type="button"
              onClick={() =>
                navigator.clipboard?.writeText(
                  JSON.stringify(row.raw_payload, null, 2),
                )
              }
              className="rounded border border-border/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              Copy JSON
            </button>
          </div>
          <pre className="max-h-96 overflow-auto rounded-md border border-border/60 bg-background p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(row.raw_payload, null, 2)}
          </pre>
        </div>
      )}
    </li>
  );
}

function MetaField({
  label,
  value,
  mono,
  copyable,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  copyable?: boolean;
}) {
  return (
    <div className="rounded-md border border-border/60 bg-card/40 p-2">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          {label}
        </div>
        {copyable && value ? (
          <button
            type="button"
            onClick={() => navigator.clipboard?.writeText(value)}
            className="rounded border border-border/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Copy
          </button>
        ) : null}
      </div>
      <div
        className={`mt-1 break-all text-[11px] text-foreground/80 ${mono ? "font-mono" : ""}`}
      >
        {value ?? "—"}
      </div>
    </div>
  );
}

