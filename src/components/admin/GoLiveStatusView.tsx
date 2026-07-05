import type {
  GoLiveDiagnostic,
  GoLiveStatus,
} from "@/lib/go-live-status.functions";


/**
 * Pure presentational view for the go-live status RPC payload.
 *
 * Kept free of router/mutation dependencies so it can be rendered under
 * jsdom in unit tests to verify the RPC's fields and counts render
 * correctly (see src/components/admin/GoLiveStatusView.test.tsx).
 */
export function GoLiveStatusView({
  data,
  expectedJobs,
}: {
  data: GoLiveStatus | undefined;
  expectedJobs: readonly string[];
}) {
  const cronByName = new Map(
    (data?.cron_jobs ?? []).map((j) => [j.jobname, j] as const),
  );
  const expectedRows = expectedJobs.map((name) => ({
    name,
    job: cronByName.get(name),
  }));
  const extraJobs = (data?.cron_jobs ?? []).filter(
    (j) => !expectedJobs.includes(j.jobname),
  );

  const emailOk = Boolean(data?.last_email_sent_at);
  const phraseOk = (data?.rsvp_with_entry_phrase ?? 0) > 0;
  const cronOk = expectedRows.every((r) => r.job?.active);
  const activeExpectedCount = expectedRows.filter((r) => r.job?.active).length;

  return (
    <>
      <section
        aria-label="Go-live status summary"
        className="mx-auto max-w-4xl px-5 pb-6 grid gap-4 sm:grid-cols-3"
      >
        <StatusCard
          label="Cron jobs"
          ok={cronOk}
          detail={
            data
              ? `${activeExpectedCount}/${expectedRows.length} expected active`
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

      <section
        id="scheduled-jobs"
        aria-label="Scheduled jobs"
        className="mx-auto max-w-4xl px-5 pb-8 scroll-mt-16"
      >
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

      <section
        aria-label="Last successful email"
        className="mx-auto max-w-4xl px-5 pb-8"
      >
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
              No emails have been successfully sent yet.
            </div>
          )}
        </div>
      </section>

      <section
        aria-label="RSVP entry phrase assignment"
        className="mx-auto max-w-4xl px-5 pb-16"
      >
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
    </>
  );
}

export function StatusCard({
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

export function Field({
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

export function Badge({
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
