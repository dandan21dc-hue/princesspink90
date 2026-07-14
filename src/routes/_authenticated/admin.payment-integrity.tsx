import { useEffect, useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FREQUENCY_LABELS,
  getPaymentIntegrityStatus,
  runPaymentIntegrityChecksNow,
  updatePaymentIntegritySchedule,
  type IntegrityFrequency,
} from "@/lib/payment-integrity.functions";

export const Route = createFileRoute("/_authenticated/admin/payment-integrity")({
  head: () => ({
    meta: [
      { title: "Payment integrity checks — Admin" },
      {
        name: "description",
        content:
          "Configure the pg_cron schedule for the payment integrity job and review current findings.",
      },
    ],
  }),
  component: AdminPaymentIntegrityPage,
});

const FREQUENCIES: IntegrityFrequency[] = [
  "every_15m",
  "hourly",
  "every_6h",
  "daily",
  "weekly",
];

const SEVERITY_STYLES: Record<string, string> = {
  info: "bg-sky-500/15 text-sky-400",
  warning: "bg-amber-500/15 text-amber-400",
  critical: "bg-destructive/15 text-destructive",
};

function useTimezones(): string[] {
  return useMemo(() => {
    try {
      const anyIntl = Intl as unknown as {
        supportedValuesOf?: (k: string) => string[];
      };
      if (typeof anyIntl.supportedValuesOf === "function") {
        return anyIntl.supportedValuesOf("timeZone");
      }
    } catch {
      /* ignore */
    }
    return [
      "UTC",
      "Australia/Sydney",
      "Australia/Melbourne",
      "Australia/Brisbane",
      "Australia/Perth",
      "Pacific/Auckland",
      "Europe/London",
      "Europe/Berlin",
      "America/New_York",
      "America/Los_Angeles",
    ];
  }, []);
}

function AdminPaymentIntegrityPage() {
  const qc = useQueryClient();
  const statusFn = useServerFn(getPaymentIntegrityStatus);
  const updateFn = useServerFn(updatePaymentIntegritySchedule);
  const runFn = useServerFn(runPaymentIntegrityChecksNow);

  const query = useQuery({
    queryKey: ["payment-integrity-status"],
    queryFn: () => statusFn(),
    refetchInterval: 30_000,
  });

  const [frequency, setFrequency] = useState<IntegrityFrequency>("hourly");
  const [timezone, setTimezone] = useState<string>("UTC");
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  useEffect(() => {
    if (query.data?.schedule) {
      setFrequency(query.data.schedule.frequency);
      setTimezone(query.data.schedule.timezone);
    }
  }, [query.data?.schedule]);

  const timezones = useTimezones();

  const save = useMutation({
    mutationFn: () => updateFn({ data: { frequency, timezone } }),
    onSuccess: () => {
      setMsg({ kind: "ok", text: "Schedule updated and pg_cron job rescheduled." });
      qc.invalidateQueries({ queryKey: ["payment-integrity-status"] });
    },
    onError: (e: unknown) => {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    },
  });

  const runNow = useMutation({
    mutationFn: () => runFn(),
    onSuccess: (r: { touched: number }) => {
      setMsg({ kind: "ok", text: `Ran checks (${r.touched} finding(s) touched).` });
      qc.invalidateQueries({ queryKey: ["payment-integrity-status"] });
    },
    onError: (e: unknown) => {
      setMsg({ kind: "err", text: e instanceof Error ? e.message : String(e) });
    },
  });

  const schedule = query.data?.schedule ?? null;
  const findings = query.data?.findings ?? [];
  const openFindings = findings.filter((f) => f.resolved_at === null);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <h1 className="mt-4 text-3xl font-semibold">Payment integrity checks</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          A pg_cron job runs read-only checks over the payment pipeline and records findings.
          Choose how often it should run and in which timezone.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-8">
        <div className="rounded-2xl border border-border bg-card p-6">
          <h2 className="text-lg font-medium">Schedule</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Frequency</span>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as IntegrityFrequency)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {FREQUENCY_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-muted-foreground">Timezone</span>
              <input
                list="pi-timezones"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="UTC"
              />
              <datalist id="pi-timezones">
                {timezones.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              <span className="text-xs text-muted-foreground">
                Fixed-interval frequencies (every 15m / hourly / every 6h) run in UTC regardless
                of timezone. Daily and weekly use the chosen timezone.
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save & reschedule"}
            </button>
            <button
              type="button"
              onClick={() => runNow.mutate()}
              disabled={runNow.isPending}
              className="rounded-md border border-border px-4 py-2 text-sm disabled:opacity-50"
            >
              {runNow.isPending ? "Running…" : "Run checks now"}
            </button>
            {msg && (
              <span
                className={
                  msg.kind === "ok"
                    ? "text-xs text-emerald-400"
                    : "text-xs text-destructive"
                }
              >
                {msg.text}
              </span>
            )}
          </div>

          {schedule && (
            <dl className="mt-6 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
              <div>
                <dt className="font-medium text-foreground">Job name</dt>
                <dd>{schedule.job_name}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Applied cron expression</dt>
                <dd className="font-mono">{schedule.last_applied_schedule ?? "—"}</dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Last applied</dt>
                <dd>
                  {schedule.last_applied_at
                    ? new Date(schedule.last_applied_at).toLocaleString()
                    : "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-foreground">Settings updated</dt>
                <dd>{new Date(schedule.updated_at).toLocaleString()}</dd>
              </div>
            </dl>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="rounded-2xl border border-border bg-card p-6">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-medium">Findings</h2>
            <span className="text-xs text-muted-foreground">
              {openFindings.length} open · {findings.length} total shown
            </span>
          </div>
          {query.isLoading ? (
            <p className="mt-4 text-sm text-muted-foreground">Loading…</p>
          ) : findings.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              No findings recorded yet. Run the checks to populate this list.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {findings.map((f) => (
                <li key={f.id} className="py-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`rounded px-2 py-0.5 text-[10px] uppercase tracking-widest ${
                        SEVERITY_STYLES[f.severity] ?? ""
                      }`}
                    >
                      {f.severity}
                    </span>
                    <span className="font-medium">{f.check_name}</span>
                    <span className="text-muted-foreground">
                      {f.resource_kind} · {f.resource_id.slice(0, 8)}… · {f.environment}
                    </span>
                    {f.resolved_at && (
                      <span className="ml-auto rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-emerald-400">
                        resolved
                      </span>
                    )}
                  </div>
                  <pre className="mt-1 overflow-x-auto rounded bg-muted/40 p-2 text-xs">
                    {JSON.stringify(f.detail, null, 2)}
                  </pre>
                  <p className="mt-1 text-xs text-muted-foreground">
                    first seen {new Date(f.first_seen_at).toLocaleString()} · last seen{" "}
                    {new Date(f.last_seen_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
