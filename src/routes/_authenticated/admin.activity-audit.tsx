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

  const [filters, setFilters] = useState({
    action: "",
    resource: "",
    actor_id: "",
    q: "",
    from: "",
    to: "",
  });
  const [applied, setApplied] = useState(filters);
  const [page, setPage] = useState(1);
  const pageSize = 50;

  const toIsoStart = (d: string) => (d ? new Date(d + "T00:00:00").toISOString() : undefined);
  const toIsoEnd = (d: string) => (d ? new Date(d + "T23:59:59.999").toISOString() : undefined);

  const listArgs = {
    action: applied.action || undefined,
    resource: applied.resource || undefined,
    actor_id: applied.actor_id || undefined,
    q: applied.q || undefined,
    from: toIsoStart(applied.from),
    to: toIsoEnd(applied.to),
    page,
    pageSize,
  };

  const entries = useQuery({
    queryKey: ["admin-audit-entries", listArgs],
    queryFn: () => listFn({ data: listArgs }),
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-audit-entries"] });
      qc.invalidateQueries({ queryKey: ["admin-audit-purge-status"] });
    },
  });

  const purgeStatus = useQuery({
    queryKey: ["admin-audit-purge-status"],
    queryFn: () => statusFn(),
    enabled: isAdmin,
    refetchInterval: 60_000,
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

  const result = entries.data ?? { rows: [], total: 0, page, pageSize };
  const rows = Array.isArray(result) ? [] : result.rows;
  const total = Array.isArray(result) ? 0 : result.total;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
          {(() => {
            const s = purgeStatus.data;
            if (!s) return null;
            const tone =
              s.last_status === "error"
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : s.last_status === "success"
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "border-border bg-muted/20 text-muted-foreground";
            const dot =
              s.last_status === "error"
                ? "bg-destructive"
                : s.last_status === "success"
                  ? "bg-emerald-500"
                  : "bg-muted-foreground";
            return (
              <div className={`mt-3 rounded-md border px-3 py-2 text-xs ${tone}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
                  <span className="font-medium uppercase tracking-widest text-[10px]">
                    Purge {s.last_status}
                  </span>
                  <span>
                    {s.last_status === "never"
                      ? "No purge has run yet."
                      : s.last_status === "success"
                        ? `Last success: ${s.last_success_at ? new Date(s.last_success_at).toLocaleString() : "—"} · removed ${s.last_purged_count ?? 0} ${(s.last_purged_count ?? 0) === 1 ? "entry" : "entries"}`
                        : `Last attempt: ${s.last_run_at ? new Date(s.last_run_at).toLocaleString() : "—"}`}
                  </span>
                  {s.last_success_at && s.last_status === "error" && (
                    <span className="text-muted-foreground">
                      · last success {new Date(s.last_success_at).toLocaleString()}
                    </span>
                  )}
                </div>
                {s.last_error && (
                  <pre className="mt-1 whitespace-pre-wrap break-words text-[11px]">
                    {s.last_error}
                  </pre>
                )}
              </div>
            );
          })()}
        </div>
      </section>


      <section className="mx-auto max-w-5xl px-5 pb-16">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setApplied(filters);
          }}
          className="mb-4 rounded-2xl border border-border/60 bg-card/60 p-4"
        >
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Filters</div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="text-xs lg:col-span-2">
              <div className="mb-1.5 text-muted-foreground">Search</div>
              <input
                type="text"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="action or resource"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <div className="mb-1.5 text-muted-foreground">Action</div>
              <input
                type="text"
                value={filters.action}
                onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <div className="mb-1.5 text-muted-foreground">Resource</div>
              <input
                type="text"
                value={filters.resource}
                onChange={(e) => setFilters((f) => ({ ...f, resource: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs lg:col-span-2">
              <div className="mb-1.5 text-muted-foreground">Actor ID (UUID)</div>
              <input
                type="text"
                value={filters.actor_id}
                onChange={(e) => setFilters((f) => ({ ...f, actor_id: e.target.value.trim() }))}
                placeholder="00000000-0000-…"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono"
              />
            </label>
            <label className="text-xs">
              <div className="mb-1.5 text-muted-foreground">From</div>
              <input
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs">
              <div className="mb-1.5 text-muted-foreground">To</div>
              <input
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="submit"
              className="rounded-md bg-primary px-3 py-2 text-xs font-medium uppercase tracking-widest text-primary-foreground"
            >
              Apply
            </button>
            <button
              type="button"
              onClick={() => {
                const empty = { action: "", resource: "", actor_id: "", q: "", from: "", to: "" };
                setFilters(empty);
                setApplied(empty);
                setPage(1);
              }}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium uppercase tracking-widest"
            >
              Reset
            </button>
          </div>
        </form>

        <div className="mb-3 flex items-center gap-3">
          <div className="text-xs text-muted-foreground">
            {entries.isLoading
              ? "Loading…"
              : `${total} match${total === 1 ? "" : "es"} · showing ${rows.length}`}
          </div>
          <button
            onClick={() => {
              const header = ["created_at", "actor_id", "actor_display_name", "action", "resource"];
              const escape = (v: unknown) => {
                const s = v === null || v === undefined ? "" : String(v);
                return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
              };
              const lines = [
                header.join(","),
                ...rows.map((r) =>
                  [r.created_at, r.actor_id, r.actor_display_name ?? "", r.action, r.resource]
                    .map(escape)
                    .join(","),
                ),
              ];
              const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = `admin-activity-audit-${new Date().toISOString().slice(0, 10)}.csv`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            }}
            disabled={rows.length === 0}
            className="ml-auto rounded-md border border-border px-3 py-2 text-xs font-medium uppercase tracking-widest disabled:opacity-50"
          >
            Export CSV
          </button>
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
        <div className="mt-4 flex items-center justify-between gap-3 text-xs">
          <div className="text-muted-foreground">
            Page {page} of {totalPages}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1 || entries.isFetching}
              className="rounded-md border border-border px-3 py-2 uppercase tracking-widest disabled:opacity-50"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages || entries.isFetching}
              className="rounded-md border border-border px-3 py-2 uppercase tracking-widest disabled:opacity-50"
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
