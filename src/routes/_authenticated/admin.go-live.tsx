import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getGoLiveStatus } from "@/lib/go-live-status.functions";
import {
  sendTestReminderEmail,
  type TestReminderResult,
} from "@/lib/admin-test-reminder.functions";
import { GoLiveStatusView, Badge } from "@/components/admin/GoLiveStatusView";


export const Route = createFileRoute("/_authenticated/admin/go-live")({
  head: () => ({
    meta: [
      { title: "Go-Live checklist — Admin" },
      {
        name: "description",
        content:
          "Live readiness view: scheduled jobs, most recent email delivery, and RSVP entry phrase assignment.",
      },
    ],
  }),
  component: AdminGoLivePage,
});

const EXPECTED_JOBS = [
  "health-screening-expiry-reminders",
  "venue-compliance-expiry-reminders",
  "reminder-retries-every-5-min",
  "purge-expired-health-screenings",
];

function AdminGoLivePage() {
  const fn = useServerFn(getGoLiveStatus);
  const query = useQuery({
    queryKey: ["admin-go-live-status"],
    queryFn: () => fn(),
    refetchInterval: 30_000,
  });

  const queryClient = useQueryClient();
  const sendTest = useServerFn(sendTestReminderEmail);
  const [testResult, setTestResult] = useState<TestReminderResult | null>(null);
  const testMutation = useMutation({
    mutationFn: () => sendTest(),
    onSuccess: async (result) => {
      setTestResult(result);
      // Re-check the "last email send" surface + logs.
      await queryClient.invalidateQueries({ queryKey: ["admin-go-live-status"] });
      await query.refetch();
    },
    onError: () => {
      setTestResult(null);
    },
  });


  const data = query.data;
  const cronByName = new Map(
    (data?.cron_jobs ?? []).map((j) => [j.jobname, j] as const),
  );
  const expectedRows = EXPECTED_JOBS.map((name) => ({
    name,
    job: cronByName.get(name),
  }));
  const extraJobs = (data?.cron_jobs ?? []).filter(
    (j) => !EXPECTED_JOBS.includes(j.jobname),
  );

  const emailOk = Boolean(data?.last_email_sent_at);
  const phraseOk = (data?.rsvp_with_entry_phrase ?? 0) > 0;
  const cronOk = expectedRows.every((r) => r.job?.active);

  // Missing = row absent from cron.job entirely. Inactive = present but disabled.
  const missingJobs = expectedRows.filter((r) => !r.job).map((r) => r.name);
  const inactiveJobs = expectedRows
    .filter((r) => r.job && !r.job.active)
    .map((r) => r.name);

  // "No recent email" = never sent, or last successful send >24h ago. The
  // reminder/auth/transactional queues should produce at least one send/day
  // in normal operation, so a longer gap warrants an alert on the go-live page.
  const RECENT_EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;
  const lastEmailAgeMs = data?.last_email_sent_at
    ? Date.now() - new Date(data.last_email_sent_at).getTime()
    : null;
  const emailStale =
    Boolean(data) &&
    (lastEmailAgeMs === null || lastEmailAgeMs > RECENT_EMAIL_WINDOW_MS);


  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-4xl px-5 pt-16 pb-8">
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
          Go-Live checklist
        </h1>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted-foreground">
            Live readiness signals pulled directly from the database. Refreshes
            automatically every 30 seconds.
          </p>
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-busy={query.isFetching}
            className="inline-flex items-center gap-2 rounded-md border border-border/60 bg-card/60 px-3 py-1.5 text-xs font-medium uppercase tracking-widest text-foreground/90 hover:bg-card disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className={`inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent ${
                query.isFetching ? "animate-spin" : "opacity-40"
              }`}
            />
            {query.isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </header>


      {query.error && (
        <section className="mx-auto max-w-4xl px-5 pb-6">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {query.error instanceof Error
              ? query.error.message
              : "Failed to load Go-Live status"}
          </div>
        </section>
      )}

      {data && (missingJobs.length > 0 || inactiveJobs.length > 0 || emailStale) && (
        <section
          className="mx-auto max-w-4xl px-5 pb-6 space-y-3"
          aria-label="Go-live alerts"
        >
          {(missingJobs.length > 0 || inactiveJobs.length > 0) && (
            <AlertBanner
              severity="critical"
              title={
                missingJobs.length > 0
                  ? `${missingJobs.length} scheduled job${missingJobs.length === 1 ? "" : "s"} missing from cron`
                  : `${inactiveJobs.length} scheduled job${inactiveJobs.length === 1 ? "" : "s"} inactive`
              }
              body={
                <>
                  {missingJobs.length > 0 && (
                    <p>
                      <span className="font-semibold">Missing:</span>{" "}
                      <span className="font-mono text-[11px]">
                        {missingJobs.join(", ")}
                      </span>
                    </p>
                  )}
                  {inactiveJobs.length > 0 && (
                    <p className="mt-1">
                      <span className="font-semibold">Inactive:</span>{" "}
                      <span className="font-mono text-[11px]">
                        {inactiveJobs.join(", ")}
                      </span>
                    </p>
                  )}
                  <p className="mt-2 text-[11px] opacity-80">
                    Reminders, retries, and purges will not run until each
                    expected job is present and active.
                  </p>
                </>
              }
              actions={
                <>
                  <a
                    href="#scheduled-jobs"
                    className="rounded-md border border-current/40 px-2.5 py-1 text-[11px] font-medium uppercase tracking-widest hover:bg-current/10"
                  >
                    Jump to jobs table
                  </a>
                  <Link
                    to="/admin/system-logs"
                    className="rounded-md border border-current/40 px-2.5 py-1 text-[11px] font-medium uppercase tracking-widest hover:bg-current/10"
                  >
                    View system logs →
                  </Link>
                </>
              }
            />
          )}

          {emailStale && (
            <AlertBanner
              severity={data?.last_email_sent_at ? "warning" : "critical"}
              title={
                data?.last_email_sent_at
                  ? "No email sends in the last 24 hours"
                  : "No successful email sends recorded yet"
              }
              body={
                <p>
                  {data?.last_email_sent_at
                    ? `Last successful send: ${new Date(
                        data.last_email_sent_at,
                      ).toLocaleString()} — reminder and transactional queues should produce at least one send per day in normal operation.`
                    : "The email_send_log table has no rows with status 'sent'. Trigger a signup, RSVP, or reminder cron to exercise the send path."}
                </p>
              }
              actions={
                <Link
                  to="/admin/email-delivery"
                  className="rounded-md border border-current/40 px-2.5 py-1 text-[11px] font-medium uppercase tracking-widest hover:bg-current/10"
                >
                  Open email delivery log →
                </Link>
              }
            />
          )}
        </section>
      )}

      <GoLiveStatusView data={data ?? undefined} expectedJobs={EXPECTED_JOBS} />

      <section className="mx-auto max-w-4xl px-5 pb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
            Send a test reminder
          </h2>
          <button
            type="button"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
            aria-busy={testMutation.isPending}
            className="inline-flex items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-1.5 text-xs font-medium uppercase tracking-widest text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <span
              aria-hidden="true"
              className={`inline-block h-3 w-3 rounded-full border-2 border-current border-t-transparent ${
                testMutation.isPending ? "animate-spin" : "opacity-40"
              }`}
            />
            {testMutation.isPending ? "Sending test…" : "Send test reminder to me"}
          </button>
        </div>

        {testMutation.isError && (
          <div
            role="alert"
            className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive"
          >
            Test reminder failed:{" "}
            {testMutation.error instanceof Error
              ? testMutation.error.message
              : "unknown error"}
          </div>
        )}
        {testResult && (
          <div
            role="status"
            className={`mt-3 rounded-lg border p-3 text-xs ${
              testResult.ok
                ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-300"
                : "border-destructive/50 bg-destructive/10 text-destructive"
            }`}
          >
            <div className="font-semibold">
              {testResult.ok
                ? "Test reminder sent"
                : "Test reminder recorded as failed"}
            </div>
            <dl className="mt-2 grid gap-1 sm:grid-cols-2">
              <div>
                <dt className="opacity-70">Recipient</dt>
                <dd className="font-mono break-all">{testResult.recipient_email}</dd>
              </div>
              <div>
                <dt className="opacity-70">Message ID</dt>
                <dd className="font-mono break-all">{testResult.message_id}</dd>
              </div>
              <div>
                <dt className="opacity-70">Attempted at</dt>
                <dd>{new Date(testResult.sent_at).toLocaleString()}</dd>
              </div>
              <div>
                <dt className="opacity-70">Template</dt>
                <dd className="font-mono">{testResult.template}</dd>
              </div>
            </dl>
            {testResult.error && (
              <div className="mt-2 opacity-90">Error: {testResult.error}</div>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                to="/admin/email-delivery"
                className="rounded-md border border-current/40 px-2.5 py-1 font-medium uppercase tracking-widest hover:bg-current/10"
              >
                Open email delivery log →
              </Link>
              <button
                type="button"
                onClick={() => query.refetch()}
                className="rounded-md border border-current/40 px-2.5 py-1 font-medium uppercase tracking-widest hover:bg-current/10"
              >
                Re-check status
              </button>
            </div>
          </div>
        )}
      </section>

    </main>
  );
}


function AlertBanner({
  severity,
  title,
  body,
  actions,
}: {
  severity: "critical" | "warning";
  title: string;
  body: React.ReactNode;
  actions?: React.ReactNode;
}) {
  const tone =
    severity === "critical"
      ? "border-destructive/60 bg-destructive/10 text-destructive"
      : "border-amber-500/60 bg-amber-500/10 text-amber-400";
  const label = severity === "critical" ? "Critical" : "Warning";
  return (
    <div
      role="alert"
      className={`rounded-2xl border ${tone} p-4 shadow-sm`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ring-1 ring-current/40">
          {label}
        </span>
        <div className="flex-1 text-xs leading-relaxed">
          <div className="text-sm font-semibold">{title}</div>
          <div className="mt-1 opacity-90">{body}</div>
          {actions && (
            <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
          )}
        </div>
      </div>
    </div>
  );
}

