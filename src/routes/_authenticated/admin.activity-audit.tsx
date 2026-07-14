import { useState, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { amIAdmin } from "@/lib/admin.functions";
import {
  getAuditRetention,
  updateAuditRetention,
  listAdminAuditEntries,
  purgeExpiredAuditEntries,
  verifyAuditIntegrity,
  listAuditAlerts,
  acknowledgeAuditAlert,
  getPurgeStatus,
} from "@/lib/admin-audit.functions";

export const Route = createFileRoute("/_authenticated/admin/activity-audit")({
  head: () => ({
    meta: [
      { title: "Admin activity audit — Admin" },
      {
        name: "description",
        content:
          "Admin-only audit log with configurable retention. Only admins can view or configure it.",
      },
    ],
  }),
  component: AdminAuditPage,
});

function AdminAuditPage() {
  const meFn = useServerFn(amIAdmin);
  const retentionFn = useServerFn(getAuditRetention);
  const updateFn = useServerFn(updateAuditRetention);
  const listFn = useServerFn(listAdminAuditEntries);
  const purgeFn = useServerFn(purgeExpiredAuditEntries);
  const verifyFn = useServerFn(verifyAuditIntegrity);
  const alertsFn = useServerFn(listAuditAlerts);
  const ackFn = useServerFn(acknowledgeAuditAlert);
  const statusFn = useServerFn(getPurgeStatus);
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const isAdmin = me.data?.isAdmin === true;

  const retention = useQuery({
    queryKey: ["admin-audit-retention"],
    queryFn: () => retentionFn(),
    enabled: isAdmin,
  });

  const entries = useQuery({
    queryKey: ["admin-audit-entries"],
    queryFn: () => listFn({ data: { limit: 300 } }),
    enabled: isAdmin,
  });

  const [days, setDays] = useState<number>(90);
  useEffect(() => {
    if (retention.data?.retention_days) setDays(retention.data.retention_days);
  }, [retention.data?.retention_days]);

  const save = useMutation({
    mutationFn: (retention_days: number) => updateFn({ data: { retention_days } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-audit-retention"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-entries"] });
    },
  });

  const purge = useMutation({
    mutationFn: () => purgeFn(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-audit-entries"] }),
  });

  const alerts = useQuery({
    queryKey: ["admin-audit-alerts"],
    queryFn: () => alertsFn(),
    enabled: isAdmin,
    refetchInterval: 60_000,
  });

  const verify = useMutation({
    mutationFn: () => verifyFn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-audit-alerts"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-entries"] });
    },
  });

  const ack = useMutation({
    mutationFn: (id: string) => ackFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-audit-alerts"] }),
  });

  if (me.isLoading) {
    return (
      <main className="min-h-screen bg-background p-8 text-sm text-muted-foreground">
        Checking access…
      </main>
    );
  }

  if (!isAdmin) {
    return (
      <main className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-lg rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Admin access required. This page is restricted to administrators.
        </div>
      </main>
    );
  }

  const rows = entries.data ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
        <h1 className="mt-2 font-display text-3xl font-semibold">Activity audit</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Records of administrative activity. Access is restricted to admins by
          row-level rules; entries older than the retention window are purged
          automatically each night.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        {(() => {
          const openAlerts = (alerts.data ?? []).filter((a) => !a.acknowledged_at);
          const critical = openAlerts.filter((a) => a.severity === "critical");
          const banner =
            critical.length > 0
              ? {
                  tone: "border-destructive/50 bg-destructive/10 text-destructive",
                  label: `${critical.length} critical integrity alert${critical.length === 1 ? "" : "s"}`,
                }
              : openAlerts.length > 0
                ? {
                    tone: "border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400",
                    label: `${openAlerts.length} unacknowledged integrity alert${openAlerts.length === 1 ? "" : "s"}`,
                  }
                : verify.data && verify.data.ok
                  ? {
                      tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                      label: `Chain verified — ${verify.data.total} entries intact`,
                    }
                  : null;
          return (
            <div className="mb-4 rounded-2xl border border-border/60 bg-card/60 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <div className="text-xs uppercase tracking-widest text-muted-foreground">
                  Integrity
                </div>
                <button
                  onClick={() => verify.mutate()}
                  disabled={verify.isPending}
                  className="rounded-md bg-primary px-3 py-2 text-xs font-medium uppercase tracking-widest text-primary-foreground disabled:opacity-50"
                >
                  {verify.isPending ? "Verifying…" : "Verify chain now"}
                </button>
                <div className="ml-auto text-xs text-muted-foreground">
                  Nightly automated check at 03:30 UTC
                </div>
              </div>
              {banner && (
                <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${banner.tone}`}>
                  {banner.label}
                </div>
              )}
              {verify.error && (
                <div className="mt-3 text-xs text-destructive">
                  {verify.error instanceof Error ? verify.error.message : "Verify failed"}
                </div>
              )}
              {openAlerts.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {openAlerts.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-start justify-between gap-3 rounded-md border border-border/50 bg-background/40 p-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                              a.severity === "critical"
                                ? "bg-destructive/20 text-destructive"
                                : "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {a.severity}
                          </span>
                          <span className="text-xs font-medium">{a.kind}</span>
                          <span className="text-[10px] text-muted-foreground">
                            {new Date(a.detected_at).toLocaleString()}
                          </span>
                        </div>
                        <pre className="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">
                          {JSON.stringify(a.detail)}
                        </pre>
                      </div>
                      <button
                        onClick={() => ack.mutate(a.id)}
                        disabled={ack.isPending}
                        className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] uppercase tracking-widest disabled:opacity-50"
                      >
                        Ack
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })()}

        <div className="rounded-2xl border border-border/60 bg-card/60 p-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Retention</div>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <label className="block text-xs">
              <div className="mb-1.5 text-muted-foreground">Retention (days)</div>
              <input
                type="number"
                min={1}
                max={3650}
                value={days}
                onChange={(e) => setDays(Number(e.target.value) || 1)}
                className="w-32 rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <button
              onClick={() => save.mutate(Math.max(1, Math.min(3650, days)))}
              disabled={save.isPending}
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium uppercase tracking-widest text-primary-foreground disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button
              onClick={() => purge.mutate()}
              disabled={purge.isPending}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium uppercase tracking-widest disabled:opacity-50"
            >
              {purge.isPending ? "Purging…" : "Purge expired now"}
            </button>
            <div className="ml-auto text-xs text-muted-foreground">
              {retention.data?.retention_days
                ? `Current: ${retention.data.retention_days} days`
                : "Loading…"}
            </div>
          </div>
          {save.error && (
            <div className="mt-3 text-xs text-destructive">
              {save.error instanceof Error ? save.error.message : "Failed to save"}
            </div>
          )}
          {purge.data && (
            <div className="mt-3 text-xs text-muted-foreground">
              Purged {purge.data.purged} expired {purge.data.purged === 1 ? "entry" : "entries"}.
            </div>
          )}
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="mb-3 text-xs text-muted-foreground">
          {entries.isLoading ? "Loading…" : `${rows.length} entries`}
        </div>
        {entries.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {entries.error instanceof Error ? entries.error.message : "Failed to load"}
          </div>
        )}
        {!entries.isLoading && rows.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No audit entries recorded yet.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Action</th>
                  <th className="px-4 py-3">Resource</th>
                  <th className="px-4 py-3">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/40 align-top">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-foreground">{r.actor_display_name ?? "—"}</div>
                      <div
                        className="text-[10px] text-muted-foreground truncate max-w-[16ch]"
                        title={r.actor_id}
                      >
                        {r.actor_id.slice(0, 8)}…
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-primary">
                        {r.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{r.resource}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <pre className="whitespace-pre-wrap break-words text-[11px]">
                        {JSON.stringify(r.metadata, null, 0)}
                      </pre>
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
