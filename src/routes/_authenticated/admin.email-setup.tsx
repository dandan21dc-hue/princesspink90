import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation } from "@tanstack/react-query";
import {
  getResendDomainStatus,
  verifyResendDomain,
  RESEND_TARGET_DOMAIN,
} from "@/lib/resend-domain.functions";

export const Route = createFileRoute("/_authenticated/admin/email-setup")({
  head: () => ({
    meta: [
      { title: "Email sender setup — Admin" },
      {
        name: "description",
        content:
          "Step-by-step checklist to verify princesspink90.com in Resend with SPF, DKIM, and DMARC.",
      },
    ],
  }),
  component: EmailSetupPage,
});

type StepState = "done" | "current" | "todo";

function EmailSetupPage() {
  const statusFn = useServerFn(getResendDomainStatus);
  const verifyFn = useServerFn(verifyResendDomain);

  const query = useQuery({
    queryKey: ["resend-domain-status"],
    queryFn: () => statusFn(),
    refetchInterval: 30_000,
  });

  const verify = useMutation({
    mutationFn: () => verifyFn(),
    onSettled: () => query.refetch(),
  });

  const data = query.data;
  const isVerified = data?.status?.toLowerCase() === "verified";
  void (data?.found && !isVerified);

  const steps: Array<{ key: string; title: string; state: StepState; body: React.ReactNode }> = [
    {
      key: "add",
      title: `Add ${RESEND_TARGET_DOMAIN} in Resend`,
      state: data?.found ? "done" : "current",
      body: (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            In your Resend dashboard, open <strong>Domains → Add Domain</strong> and
            enter <code className="rounded bg-muted px-1.5 py-0.5">{RESEND_TARGET_DOMAIN}</code>.
          </p>
          <a
            href="https://resend.com/domains"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-4"
          >
            Open Resend Domains ↗
          </a>
        </div>
      ),
    },
    {
      key: "dns",
      title: "Paste the SPF, DKIM, and DMARC records at your registrar",
      state: !data?.found ? "todo" : isVerified ? "done" : "current",
      body: (
        <RecordsBlock data={data} />
      ),
    },
    {
      key: "verify",
      title: "Verify DNS",
      state: !data?.found ? "todo" : isVerified ? "done" : "current",
      body: (
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            DNS propagation typically takes 5–60 minutes. Once records are live at
            your registrar, click below to ask Resend to re-check.
          </p>
          <button
            type="button"
            disabled={!data?.found || verify.isPending}
            onClick={() => verify.mutate()}
            className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-sm font-medium text-primary hover:bg-primary/15 disabled:opacity-50"
          >
            {verify.isPending ? "Asking Resend…" : "Re-check verification"}
          </button>
          {verify.data?.error && (
            <p className="text-destructive">{verify.data.error}</p>
          )}
          {verify.data?.ok && (
            <p className="text-emerald-600">Re-check requested. Status refreshes below.</p>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-4xl px-5 pt-8 pb-4">
        <h1 className="text-2xl font-semibold">Email sender setup</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Get <code className="rounded bg-muted px-1.5 py-0.5">support@{RESEND_TARGET_DOMAIN}</code>{" "}
          delivering reliably by verifying the domain in Resend.
        </p>
      </header>

      <section className="mx-auto max-w-4xl px-5 pb-4">
        <OverallStatus data={data} loading={query.isLoading} />
      </section>

      <section className="mx-auto max-w-4xl px-5 pb-16">
        <ol className="space-y-4">
          {steps.map((step, i) => (
            <li
              key={step.key}
              className="rounded-2xl border border-border/60 bg-card/60 p-5"
            >
              <div className="flex items-start gap-3">
                <StepBadge index={i + 1} state={step.state} />
                <div className="flex-1">
                  <h2 className="text-base font-semibold">{step.title}</h2>
                  <div className="mt-2">{step.body}</div>
                </div>
              </div>
            </li>
          ))}
        </ol>

        {data?.fetchedAt && (
          <div className="mt-4 text-xs text-muted-foreground">
            Last checked {new Date(data.fetchedAt).toLocaleString()}. Auto-refreshes every 30s.
          </div>
        )}
        {data && !data.configured && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            RESEND_API_KEY is not configured on the server. Add it in Project Settings to
            enable this checklist.
          </div>
        )}
        {data?.error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {data.error}
          </div>
        )}
      </section>
    </div>
  );
}

function OverallStatus({
  data,
  loading,
}: {
  data: Awaited<ReturnType<typeof getResendDomainStatus>> | undefined;
  loading: boolean;
}) {
  if (loading) return <StatusPill tone="muted" label="Checking Resend…" />;
  if (!data?.configured)
    return <StatusPill tone="destructive" label="RESEND_API_KEY missing" />;
  if (!data.found)
    return <StatusPill tone="warning" label={`${RESEND_TARGET_DOMAIN} not yet added in Resend`} />;
  const s = (data.status ?? "").toLowerCase();
  if (s === "verified") return <StatusPill tone="success" label="Verified — sending live" />;
  if (s === "failed" || s === "temporary_failure")
    return <StatusPill tone="destructive" label={`Verification ${s.replace("_", " ")}`} />;
  return <StatusPill tone="warning" label={`Pending verification (${s || "unknown"})`} />;
}

function StatusPill({
  tone,
  label,
}: {
  tone: "success" | "warning" | "destructive" | "muted";
  label: string;
}) {
  const styles: Record<typeof tone, string> = {
    success: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    warning: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    destructive: "bg-destructive/15 text-destructive border-destructive/30",
    muted: "bg-muted text-muted-foreground border-border",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${styles[tone]}`}
    >
      <span className="h-2 w-2 rounded-full bg-current" />
      {label}
    </span>
  );
}

function StepBadge({ index, state }: { index: number; state: StepState }) {
  const styles: Record<StepState, string> = {
    done: "bg-emerald-500 text-white",
    current: "bg-primary text-primary-foreground",
    todo: "bg-muted text-muted-foreground",
  };
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${styles[state]}`}
      aria-label={`Step ${index} ${state}`}
    >
      {state === "done" ? "✓" : index}
    </div>
  );
}

function RecordsBlock({
  data,
}: {
  data: Awaited<ReturnType<typeof getResendDomainStatus>> | undefined;
}) {
  if (!data?.found) {
    return (
      <p className="text-sm text-muted-foreground">
        Complete step 1 to see the exact records Resend expects.
      </p>
    );
  }
  if (data.records.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Resend hasn't returned any records for this domain yet. Refresh in a moment.
      </p>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Add these at your DNS provider for{" "}
        <code className="rounded bg-muted px-1.5 py-0.5">{RESEND_TARGET_DOMAIN}</code>. Each row's
        status updates once DNS propagates.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border/60">
        <table className="w-full text-xs">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Purpose</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Value</th>
              <th className="px-3 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {data.records.map((r, i) => (
              <tr key={i} className="border-t border-border/60 align-top">
                <td className="px-3 py-2 font-medium">{r.record || "—"}</td>
                <td className="px-3 py-2 font-mono">{r.type}</td>
                <td className="px-3 py-2 font-mono break-all">{r.name}</td>
                <td className="px-3 py-2 font-mono break-all">
                  <div className="flex items-start gap-2">
                    <code className="flex-1">{r.value}</code>
                    <CopyButton text={r.value} />
                  </div>
                </td>
                <td className="px-3 py-2">
                  <RecordStatusPill status={r.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecordStatusPill({ status }: { status?: string | null }) {
  const s = (status ?? "").toLowerCase();
  if (s === "verified")
    return (
      <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-emerald-500">
        Verified
      </span>
    );
  if (s === "failed")
    return (
      <span className="rounded-full bg-destructive/15 px-2 py-0.5 text-destructive">
        Failed
      </span>
    );
  return (
    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-amber-500">
      {s || "pending"}
    </span>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* noop */
        }
      }}
      className="shrink-0 rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}
