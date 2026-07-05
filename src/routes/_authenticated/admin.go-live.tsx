import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getGoLiveStatus } from "@/lib/go-live-status.functions";

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

      <section className="mx-auto max-w-4xl px-5 pb-6 grid gap-4 sm:grid-cols-3">
        <StatusCard
          label="Cron jobs"
          ok={cronOk}
          detail={
            data
              ? `${expectedRows.filter((r) => r.job?.active).length}/${
                  expectedRows.length
                } expected active`
              : "Loading…"
          }
        />
        <StatusCard
          label="Email sending"
          ok={emailOk}
          detail={
            data?.last_email_sent_at
              ? `Last: ${new Date(data.last_email_sent_at).toLocaleString()}`
              : "No successful sends yet"
          }
        />
        <StatusCard
          label="RSVP entry phrase"
          ok={phraseOk}
          detail={
            data
              ? `${data.rsvp_with_entry_phrase}/${data.rsvp_total} RSVPs`
              : "Loading…"
          }
        />
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-8">
        <h2 className="mb-3 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Scheduled jobs
        </h2>
        <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Job</th>
                <th className="px-4 py-3">Schedule</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {expectedRows.map(({ name, job }) => (
                <tr key={name} className="border-t border-border/40">
                  <td className="px-4 py-3 font-mono text-xs">{name}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {job?.schedule ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {!job ? (
                      <Badge kind="warn">missing</Badge>
                    ) : job.active ? (
                      <Badge kind="ok">active</Badge>
                    ) : (
                      <Badge kind="bad">inactive</Badge>
                    )}
                  </td>
                </tr>
              ))}
              {extraJobs.map((job) => (
                <tr
                  key={job.jobname}
                  className="border-t border-border/40 opacity-70"
                >
                  <td className="px-4 py-3 font-mono text-xs">{job.jobname}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                    {job.schedule}
                  </td>
                  <td className="px-4 py-3">
                    {job.active ? (
                      <Badge kind="ok">active</Badge>
                    ) : (
                      <Badge kind="bad">inactive</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-8">
        <h2 className="mb-3 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          Last successful email
        </h2>
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4 text-sm">
          {data?.last_email_sent_at ? (
            <dl className="grid gap-2 sm:grid-cols-3">
              <Field label="Sent at">
                {new Date(data.last_email_sent_at).toLocaleString()}
              </Field>
              <Field label="Template">{data.last_email_template ?? "—"}</Field>
              <Field label="Recipient">
                {data.last_email_recipient ?? "—"}
              </Field>
            </dl>
          ) : (
            <div className="text-muted-foreground">
              No emails have been successfully sent yet. Trigger a signup or
              RSVP to exercise the path.
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-16">
        <h2 className="mb-3 text-xs uppercase tracking-[0.3em] text-muted-foreground">
          RSVP entry phrase assignment
        </h2>
        <div className="rounded-2xl border border-border/60 bg-card/60 p-4 text-sm">
          {data ? (
            <dl className="grid gap-2 sm:grid-cols-3">
              <Field label="Total RSVPs">{data.rsvp_total}</Field>
              <Field label="With entry phrase">
                {data.rsvp_with_entry_phrase}
              </Field>
              <Field label="Most recent assignment">
                {data.last_entry_phrase_at
                  ? new Date(data.last_entry_phrase_at).toLocaleString()
                  : "—"}
              </Field>
            </dl>
          ) : (
            <div className="text-muted-foreground">Loading…</div>
          )}
          {data && data.rsvp_total > 0 && data.rsvp_with_entry_phrase === 0 && (
            <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
              RSVPs exist but none have an entry phrase — the assignment
              trigger may not be firing.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function StatusCard({
  label,
  ok,
  detail,
}: {
  label: string;
  ok: boolean;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
          {label}
        </div>
        <Badge kind={ok ? "ok" : "warn"}>{ok ? "ready" : "not yet"}</Badge>
      </div>
      <div className="mt-3 text-sm text-foreground/80">{detail}</div>
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
    <div>
      <dt className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 break-all">{children}</dd>
    </div>
  );
}

function Badge({
  kind,
  children,
}: {
  kind: "ok" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const styles =
    kind === "ok"
      ? "bg-emerald-500/15 text-emerald-400"
      : kind === "bad"
        ? "bg-destructive/15 text-destructive"
        : "bg-amber-500/15 text-amber-400";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${styles}`}
    >
      {children}
    </span>
  );
}
