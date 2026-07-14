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
  setAuditEntryQuarantine,
  type AuditTrustState,
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

  const emptyFilters = {
    q: "",
    action: "",
    action_match: "contains" as "contains" | "exact",
    resource: "",
    resource_match: "contains" as "contains" | "exact",
    actor_id: "",
    actor_name: "",
    from: "",
    to: "",
    trust: "all" as "all" | AuditTrustState,
  };
  const [filters, setFilters] = useState(emptyFilters);
  const [applied, setApplied] = useState(emptyFilters);

  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [viewMode, setViewMode] = useState<"table" | "timeline">("table");
  const [sort, setSort] = useState<"created_at" | "action" | "resource" | "actor_id">("created_at");
  const [dir, setDir] = useState<"asc" | "desc">("desc");
  const toggleSort = (col: typeof sort) => {
    if (sort === col) setDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSort(col);
      setDir(col === "created_at" ? "desc" : "asc");
    }
    setPage(1);
  };
  const applyPreset = (preset: "newest" | "oldest") => {
    setSort("created_at");
    setDir(preset === "newest" ? "desc" : "asc");
    setPage(1);
  };
  const isPreset = (preset: "newest" | "oldest") =>
    sort === "created_at" && dir === (preset === "newest" ? "desc" : "asc");

  const toIsoStart = (d: string) => (d ? new Date(d + "T00:00:00").toISOString() : undefined);
  const toIsoEnd = (d: string) => (d ? new Date(d + "T23:59:59.999").toISOString() : undefined);

  const uuidRe = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const actorIdValid = !applied.actor_id || uuidRe.test(applied.actor_id);

  const listArgs = {
    action: applied.action || undefined,
    action_match: applied.action ? applied.action_match : undefined,
    resource: applied.resource || undefined,
    resource_match: applied.resource ? applied.resource_match : undefined,
    actor_id: applied.actor_id && actorIdValid ? applied.actor_id : undefined,
    actor_name: applied.actor_name || undefined,
    q: applied.q || undefined,
    from: toIsoStart(applied.from),
    to: toIsoEnd(applied.to),
    trust: applied.trust,
    page,
    pageSize,
    sort,
    dir,
  };
  const activeFilterCount = [
    applied.q,
    applied.action,
    applied.resource,
    applied.actor_id,
    applied.actor_name,
    applied.from,
    applied.to,
    applied.trust !== "all" ? applied.trust : "",
  ].filter(Boolean).length;


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

  const quarantineFn = useServerFn(setAuditEntryQuarantine);
  const quarantine = useMutation({
    mutationFn: (v: { id: string; quarantined: boolean; reason?: string }) =>
      quarantineFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["admin-audit-entries"] }),
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
        {(() => {
          const trustChips: Array<{ key: "all" | AuditTrustState; label: string; tone: string }> = [
            { key: "all", label: "All", tone: "text-muted-foreground" },
            { key: "trusted", label: "Trusted", tone: "text-emerald-600 dark:text-emerald-400" },
            { key: "untrusted", label: "Untrusted", tone: "text-destructive" },
            { key: "quarantined", label: "Quarantined", tone: "text-amber-600 dark:text-amber-400" },
          ];
          return (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="text-[11px] uppercase tracking-widest text-muted-foreground">Trust</span>
              <div className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/60 p-0.5 text-[11px]">
                {trustChips.map((c) => {
                  const active = applied.trust === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      aria-pressed={active}
                      onClick={() => {
                        setFilters((f) => ({ ...f, trust: c.key }));
                        setApplied((a) => ({ ...a, trust: c.key }));
                        setPage(1);
                      }}
                      className={`rounded px-2 py-1 uppercase tracking-widest ${
                        active
                          ? "bg-primary text-primary-foreground"
                          : `${c.tone} hover:text-foreground`
                      }`}
                    >
                      {c.label}
                    </button>
                  );
                })}
              </div>
              {quarantine.error && (
                <span className="text-[11px] text-destructive">
                  {quarantine.error instanceof Error ? quarantine.error.message : "Failed"}
                </span>
              )}
            </div>
          );
        })()}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            setPage(1);
            setApplied(filters);
          }}
          className="mb-4 rounded-2xl border border-border/60 bg-card/60 p-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Filters {activeFilterCount > 0 && (
                <span className="ml-1 rounded bg-primary/15 px-1.5 py-0.5 text-[10px] text-primary">
                  {activeFilterCount} active
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAdvancedOpen((v) => !v)}
              className="text-[11px] uppercase tracking-widest text-primary hover:underline"
              aria-expanded={advancedOpen}
            >
              {advancedOpen ? "Hide advanced ▲" : "Advanced ▼"}
            </button>
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
            <label className="text-xs lg:col-span-3">
              <div className="mb-1.5 text-muted-foreground">Search</div>
              <input
                type="text"
                value={filters.q}
                onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
                placeholder="Sequence #, entry ID, action, resource, or any metadata value"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <label className="text-xs lg:col-span-3">
              <div className="mb-1.5 text-muted-foreground">Admin user (name)</div>
              <input
                type="text"
                value={filters.actor_name}
                onChange={(e) => setFilters((f) => ({ ...f, actor_name: e.target.value }))}
                placeholder="e.g. Ada Lovelace"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
            <div className="text-xs lg:col-span-3">
              <div className="mb-1.5 flex items-center justify-between text-muted-foreground">
                <span>Action type</span>
                <label className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest">
                  <input
                    type="checkbox"
                    checked={filters.action_match === "exact"}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        action_match: e.target.checked ? "exact" : "contains",
                      }))
                    }
                  />
                  Exact
                </label>
              </div>
              <input
                type="text"
                value={filters.action}
                onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
                placeholder={filters.action_match === "exact" ? "e.g. update_retention" : "contains…"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                list="audit-action-suggestions"
              />
              <datalist id="audit-action-suggestions">
                {Array.from(new Set(rows.map((r) => r.action))).map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>
            <div className="text-xs lg:col-span-3">
              <div className="mb-1.5 flex items-center justify-between text-muted-foreground">
                <span>Resource identifier</span>
                <label className="inline-flex items-center gap-1 text-[10px] uppercase tracking-widest">
                  <input
                    type="checkbox"
                    checked={filters.resource_match === "exact"}
                    onChange={(e) =>
                      setFilters((f) => ({
                        ...f,
                        resource_match: e.target.checked ? "exact" : "contains",
                      }))
                    }
                  />
                  Exact
                </label>
              </div>
              <input
                type="text"
                value={filters.resource}
                onChange={(e) => setFilters((f) => ({ ...f, resource: e.target.value }))}
                placeholder={filters.resource_match === "exact" ? "e.g. private_room_bookings" : "contains…"}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                list="audit-resource-suggestions"
              />
              <datalist id="audit-resource-suggestions">
                {Array.from(new Set(rows.map((r) => r.resource))).map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            </div>
            {advancedOpen && (
              <>
                <label className="text-xs lg:col-span-3">
                  <div className="mb-1.5 text-muted-foreground">
                    Admin user ID (UUID){" "}
                    {applied.actor_id && !actorIdValid && (
                      <span className="text-destructive">— invalid UUID, ignored</span>
                    )}
                  </div>
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
              </>
            )}
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
                setFilters(emptyFilters);
                setApplied(emptyFilters);
                setPage(1);
              }}
              className="rounded-md border border-border px-3 py-2 text-xs font-medium uppercase tracking-widest"
            >
              Reset
            </button>
          </div>
        </form>

        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-card/60 p-0.5 text-[11px]">
            <span className="px-2 text-muted-foreground uppercase tracking-widest">Sort</span>
            <button
              type="button"
              onClick={() => applyPreset("newest")}
              className={`rounded px-2 py-1 uppercase tracking-widest ${
                isPreset("newest")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={isPreset("newest")}
            >
              Newest
            </button>
            <button
              type="button"
              onClick={() => applyPreset("oldest")}
              className={`rounded px-2 py-1 uppercase tracking-widest ${
                isPreset("oldest")
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              aria-pressed={isPreset("oldest")}
            >
              Oldest
            </button>
            {sort !== "created_at" && (
              <span className="px-2 text-muted-foreground">
                Sorted by {sort} {dir === "asc" ? "↑" : "↓"}
              </span>
            )}
          </div>
          <label className="inline-flex items-center gap-2 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-widest">Per page</span>
            <select
              value={pageSize}
              onChange={(e) => {
                setPageSize(Number(e.target.value));
                setPage(1);
              }}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-muted-foreground">
            {entries.isLoading
              ? "Loading…"
              : `${total} match${total === 1 ? "" : "es"} · showing ${rows.length}`}
          </div>
          {(alerts.data ?? []).some((a) => !a.acknowledged_at) && (
            <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-600 dark:text-amber-400">
              Severity → see integrity alerts above
            </span>
          )}
          <button
            onClick={async () => {
              if (exporting) return;
              setExportError(null);
              setExporting(true);
              try {
                const header = [
                  "created_at",
                  "actor_id",
                  "actor_display_name",
                  "action",
                  "resource",
                  "metadata",
                ];
                const escape = (v: unknown) => {
                  const s = v === null || v === undefined ? "" : String(v);
                  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
                };
                const MAX_ROWS = 10_000;
                const EXPORT_PAGE = 200;
                const all: typeof rows = [];
                for (let p = 1; ; p++) {
                  const res = await listFn({
                    data: { ...listArgs, page: p, pageSize: EXPORT_PAGE },
                  });
                  const batch = Array.isArray(res) ? [] : res.rows;
                  all.push(...batch);
                  const totalCount = Array.isArray(res) ? 0 : res.total;
                  if (
                    batch.length < EXPORT_PAGE ||
                    all.length >= totalCount ||
                    all.length >= MAX_ROWS
                  ) {
                    break;
                  }
                }
                const truncated = all.length >= MAX_ROWS && all.length < total;
                const lines = [
                  header.join(","),
                  ...all
                    .slice(0, MAX_ROWS)
                    .map((r) =>
                      [
                        r.created_at,
                        r.actor_id,
                        r.actor_display_name ?? "",
                        r.action,
                        r.resource,
                        JSON.stringify(r.metadata ?? {}),
                      ]
                        .map(escape)
                        .join(","),
                    ),
                ];
                const blob = new Blob(["\ufeff" + lines.join("\n")], {
                  type: "text/csv;charset=utf-8",
                });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                const rangeSuffix =
                  applied.from || applied.to
                    ? `_${applied.from || "start"}_to_${applied.to || "now"}`
                    : "";
                a.href = url;
                a.download = `admin-activity-audit${rangeSuffix}_${new Date().toISOString().slice(0, 10)}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                if (truncated) {
                  setExportError(
                    `Export capped at ${MAX_ROWS.toLocaleString()} rows. Narrow the date range to export the rest.`,
                  );
                }
              } catch (e) {
                setExportError(e instanceof Error ? e.message : "Export failed");
              } finally {
                setExporting(false);
              }
            }}
            disabled={exporting || total === 0}
            className="ml-auto rounded-md border border-border px-3 py-2 text-xs font-medium uppercase tracking-widest disabled:opacity-50"
          >
            {exporting ? "Exporting…" : `Export CSV (${total.toLocaleString()})`}
          </button>
        </div>
        {exportError && (
          <div className="mb-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            {exportError}
          </div>
        )}

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
                  {([
                    ["created_at", "When"],
                    ["actor_id", "Actor"],
                    ["action", "Action"],
                    ["resource", "Resource"],
                  ] as const).map(([col, label]) => {
                    const active = sort === col;
                    const arrow = active ? (dir === "asc" ? "↑" : "↓") : "↕";
                    return (
                      <th key={col} className="px-4 py-3">
                        <button
                          type="button"
                          onClick={() => toggleSort(col)}
                          className={`inline-flex items-center gap-1 uppercase tracking-widest ${active ? "text-foreground" : ""}`}
                          aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
                        >
                          {label}
                          <span className="text-[10px] opacity-70">{arrow}</span>
                        </button>
                      </th>
                    );
                  })}
                  <th className="px-4 py-3">Trust</th>
                  <th className="px-4 py-3">Metadata</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const trustTone =
                    r.trust === "trusted"
                      ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                      : r.trust === "untrusted"
                        ? "bg-destructive/15 text-destructive"
                        : "bg-amber-500/15 text-amber-600 dark:text-amber-400";
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className="cursor-pointer border-t border-border/40 align-top hover:bg-muted/20"
                    >
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
                      <td className="px-4 py-3 text-xs">
                        <span
                          className={`inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${trustTone}`}
                          title={r.quarantine_reason ?? undefined}
                        >
                          {r.trust}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (r.trust === "quarantined") {
                              quarantine.mutate({ id: r.id, quarantined: false });
                            } else {
                              const reason = window.prompt(
                                "Quarantine reason (optional):",
                                "",
                              );
                              if (reason === null) return; // cancelled
                              quarantine.mutate({
                                id: r.id,
                                quarantined: true,
                                reason: reason || undefined,
                              });
                            }
                          }}
                          disabled={quarantine.isPending}
                          className="ml-2 rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-widest hover:bg-muted/40 disabled:opacity-50"
                        >
                          {r.trust === "quarantined" ? "Release" : "Quarantine"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        <pre className="whitespace-pre-wrap break-words text-[11px] line-clamp-2">
                          {JSON.stringify(r.metadata, null, 0)}
                        </pre>
                        <span className="mt-1 inline-block text-[10px] uppercase tracking-widest text-primary">
                          View details →
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

            </table>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3 text-muted-foreground">
            <span>
              Page {page} of {totalPages}
            </span>
            {total > 0 && (
              <span className="hidden sm:inline">
                · rows {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total.toLocaleString()}
              </span>
            )}
            <label className="inline-flex items-center gap-1">
              <span className="uppercase tracking-widest">Go to</span>
              <input
                type="number"
                min={1}
                max={totalPages}
                value={page}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  setPage(Math.max(1, Math.min(totalPages, Math.floor(n))));
                }}
                className="w-16 rounded-md border border-input bg-background px-2 py-1 text-xs"
              />
            </label>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={page <= 1 || entries.isFetching}
              className="rounded-md border border-border px-3 py-2 uppercase tracking-widest disabled:opacity-50"
              aria-label="First page"
            >
              « First
            </button>
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
            <button
              type="button"
              onClick={() => setPage(totalPages)}
              disabled={page >= totalPages || entries.isFetching}
              className="rounded-md border border-border px-3 py-2 uppercase tracking-widest disabled:opacity-50"
              aria-label="Last page"
            >
              Last »
            </button>
          </div>
        </div>
      </section>
      {selectedId && (
        <AuditEntryDrawer
          entry={rows.find((r) => r.id === selectedId) ?? null}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}

type AuditRow = {
  id: string;
  seq?: number;
  prev_hash?: string;
  entry_hash?: string;
  created_at: string;
  actor_id: string;
  actor_display_name?: string | null;
  action: string;
  resource: string;
  metadata: unknown;
};

function AuditEntryDrawer({
  entry,
  onClose,
}: {
  entry: AuditRow | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!entry) return null;
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const before = pickPair(meta, ["before", "old", "previous", "prev", "from"]);
  const after = pickPair(meta, ["after", "new", "next", "to"]);
  const request = pickPair(meta, ["request", "req", "payload", "input", "params"]);
  const response = pickPair(meta, ["response", "res", "result", "output"]);
  const otherMeta: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (
      ["before", "old", "previous", "prev", "from", "after", "new", "next", "to",
        "request", "req", "payload", "input", "params",
        "response", "res", "result", "output"].includes(k)
    ) continue;
    otherMeta[k] = v;
  }
  const diff = before && after ? buildDiff(before, after) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-background/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Audit entry details"
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="h-full w-full max-w-2xl overflow-y-auto border-l border-border/60 bg-card p-6 shadow-2xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-[0.3em] text-primary">Audit entry</div>
            <h2 className="mt-1 font-display text-xl font-semibold">{entry.action}</h2>
            <div className="mt-1 text-xs text-muted-foreground">
              on <span className="text-foreground">{entry.resource}</span> ·{" "}
              {new Date(entry.created_at).toLocaleString()}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-widest hover:bg-muted/40"
          >
            Close
          </button>
        </div>

        <dl className="mt-5 grid grid-cols-3 gap-3 rounded-lg border border-border/60 bg-background/40 p-4 text-xs">
          <MetaField label="Entry ID" value={entry.id} mono />
          <MetaField label="Seq" value={entry.seq != null ? String(entry.seq) : "—"} />
          <MetaField
            label="Actor"
            value={
              (entry.actor_display_name ? entry.actor_display_name + " · " : "") +
              entry.actor_id
            }
            mono
          />
          {entry.prev_hash && <MetaField label="Prev hash" value={entry.prev_hash} mono />}
          {entry.entry_hash && <MetaField label="Entry hash" value={entry.entry_hash} mono />}
        </dl>

        {diff && (
          <Section title={`Diff (${diff.length} change${diff.length === 1 ? "" : "s"})`}>
            {diff.length === 0 ? (
              <div className="text-xs text-muted-foreground">No field-level changes recorded.</div>
            ) : (
              <ul className="divide-y divide-border/40 rounded-md border border-border/60">
                {diff.map((d) => (
                  <li key={d.key} className="grid grid-cols-[8rem,1fr,1fr] gap-2 px-3 py-2 text-xs">
                    <div className="font-mono text-muted-foreground truncate" title={d.key}>
                      {d.key}
                    </div>
                    <div className="rounded bg-destructive/10 px-2 py-1 font-mono text-[11px] text-destructive">
                      <div className="text-[9px] uppercase tracking-widest opacity-70">Before</div>
                      <pre className="whitespace-pre-wrap break-words">{fmtVal(d.before)}</pre>
                    </div>
                    <div className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-emerald-600 dark:text-emerald-400">
                      <div className="text-[9px] uppercase tracking-widest opacity-70">After</div>
                      <pre className="whitespace-pre-wrap break-words">{fmtVal(d.after)}</pre>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {before && !diff && <JsonSection title="Before" data={before} tone="destructive" />}
        {after && !diff && <JsonSection title="After" data={after} tone="emerald" />}
        {request && <JsonSection title="Request" data={request} />}
        {response && <JsonSection title="Response" data={response} />}
        {(Object.keys(otherMeta).length > 0 || (!before && !after && !request && !response)) && (
          <JsonSection
            title="Metadata"
            data={Object.keys(otherMeta).length > 0 ? otherMeta : meta}
          />
        )}
      </aside>
    </div>
  );
}

function MetaField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="col-span-3 sm:col-span-1">
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 break-all ${mono ? "font-mono text-[11px]" : ""}`}>{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5">
      <h3 className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function JsonSection({
  title,
  data,
  tone,
}: {
  title: string;
  data: unknown;
  tone?: "destructive" | "emerald";
}) {
  const toneCls =
    tone === "destructive"
      ? "border-destructive/40 bg-destructive/5"
      : tone === "emerald"
        ? "border-emerald-500/40 bg-emerald-500/5"
        : "border-border/60 bg-background/40";
  const text = JSON.stringify(data, null, 2);
  return (
    <Section title={title}>
      <div className={`relative rounded-md border ${toneCls}`}>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(text)}
          className="absolute right-2 top-2 rounded border border-border bg-background/70 px-2 py-0.5 text-[10px] uppercase tracking-widest hover:bg-background"
        >
          Copy
        </button>
        <pre className="max-h-80 overflow-auto p-3 text-[11px] leading-relaxed whitespace-pre-wrap break-words">
          {text}
        </pre>
      </div>
    </Section>
  );
}

function pickPair(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | null {
  for (const k of keys) {
    const v = obj[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    if (v !== undefined && v !== null && typeof v !== "object") {
      return { [k]: v };
    }
  }
  return null;
}

type DiffRow = { key: string; before: unknown; after: unknown };
function buildDiff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): DiffRow[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: DiffRow[] = [];
  for (const k of keys) {
    const b = before[k];
    const a = after[k];
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.push({ key: k, before: b, after: a });
    }
  }
  return out.sort((x, y) => x.key.localeCompare(y.key));
}

function fmtVal(v: unknown): string {
  if (v === undefined) return "(unset)";
  if (v === null) return "null";
  if (typeof v === "string") return v;
  return JSON.stringify(v, null, 2);
}
