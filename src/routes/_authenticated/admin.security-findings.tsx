import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ShieldCheck, Plus, Trash2, X, Search } from "lucide-react";
import { toast } from "sonner";
import { RoleGuard } from "@/components/RoleGuard";
import {
  listSecurityScans,
  listSecurityScanFindings,
  createSecurityScan,
  deleteSecurityScan,
} from "@/lib/security-scans.functions";

export const Route = createFileRoute("/_authenticated/admin/security-findings")({
  head: () => ({
    meta: [
      { title: "Security Findings · Admin · Midnight Glory" },
      { name: "description", content: "Admin-only archive of security scan findings, filterable and grouped by internal_id." },
    ],
  }),
  component: Page,
});

type Scan = {
  id: string;
  scanned_at: string;
  note: string | null;
  finding_count: number;
  created_by: string | null;
};

type Finding = {
  id: string;
  scan_id: string;
  scanned_at: string;
  internal_id: string;
  scanner_name: string;
  name: string;
  category: string;
  level: string;
  state: string;
  description: string;
  details: string;
};

function Page() {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <SecurityFindingsView />
    </RoleGuard>
  );
}

function SecurityFindingsView() {
  const listScansFn = useServerFn(listSecurityScans);
  const listFindingsFn = useServerFn(listSecurityScanFindings);
  const createFn = useServerFn(createSecurityScan);
  const deleteFn = useServerFn(deleteSecurityScan);
  const qc = useQueryClient();

  const scans = useQuery<Scan[]>({
    queryKey: ["security-scans"],
    queryFn: () => listScansFn(),
  });

  const findings = useQuery<Finding[]>({
    queryKey: ["security-scan-findings"],
    queryFn: () => listFindingsFn(),
  });

  const [query, setQuery] = useState("");
  const [levelFilter, setLevelFilter] = useState<string>("");
  const [stateFilter, setStateFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);

  const allFindings = findings.data ?? [];
  const allScans = scans.data ?? [];

  const levels = useMemo(
    () => Array.from(new Set(allFindings.map((f) => f.level).filter(Boolean))).sort(),
    [allFindings],
  );
  const states = useMemo(
    () => Array.from(new Set(allFindings.map((f) => f.state).filter(Boolean))).sort(),
    [allFindings],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allFindings.filter((f) => {
      if (levelFilter && f.level !== levelFilter) return false;
      if (stateFilter && f.state !== stateFilter) return false;
      if (!q) return true;
      return (
        f.internal_id.toLowerCase().includes(q) ||
        f.name.toLowerCase().includes(q) ||
        f.scanner_name.toLowerCase().includes(q) ||
        f.category.toLowerCase().includes(q) ||
        f.description.toLowerCase().includes(q)
      );
    });
  }, [allFindings, query, levelFilter, stateFilter]);

  const grouped = useMemo(() => {
    const map = new Map<string, Finding[]>();
    for (const f of filtered) {
      const list = map.get(f.internal_id) ?? [];
      list.push(f);
      map.set(f.internal_id, list);
    }
    return Array.from(map.entries())
      .map(([internal_id, rows]) => ({
        internal_id,
        rows: rows.sort((a, b) => (a.scanned_at < b.scanned_at ? 1 : -1)),
      }))
      .sort((a, b) =>
        (b.rows[0]?.scanned_at ?? "").localeCompare(a.rows[0]?.scanned_at ?? ""),
      );
  }, [filtered]);

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Scan deleted");
      qc.invalidateQueries({ queryKey: ["security-scans"] });
      qc.invalidateQueries({ queryKey: ["security-scan-findings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="mx-auto max-w-6xl px-5 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            Admin
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Security findings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Search and group security status changes by <code>internal_id</code> across scans.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setImporting(true)}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Record scan
        </button>
      </header>

      <div className="mt-6 grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by internal_id, name, category, description…"
            className="w-full rounded-md border border-border/60 bg-background py-2 pl-9 pr-3 text-sm"
            aria-label="Search findings"
          />
        </label>
        <select
          value={levelFilter}
          onChange={(e) => setLevelFilter(e.target.value)}
          className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
          aria-label="Filter by level"
        >
          <option value="">All levels</option>
          {levels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <select
          value={stateFilter}
          onChange={(e) => setStateFilter(e.target.value)}
          className="rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          {states.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 text-xs text-muted-foreground">
        {allScans.length} scan{allScans.length === 1 ? "" : "s"} archived ·{" "}
        {grouped.length} unique finding{grouped.length === 1 ? "" : "s"} match filters ·{" "}
        {filtered.length} snapshot row{filtered.length === 1 ? "" : "s"} total
      </div>

      {allScans.length > 0 && (
        <details className="mt-4 rounded-2xl border border-border/60 bg-card/40 p-4">
          <summary className="cursor-pointer text-xs uppercase tracking-widest text-muted-foreground">
            Scans ({allScans.length})
          </summary>
          <ul className="mt-3 space-y-1 text-sm">
            {allScans.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <span className="text-foreground">
                    {new Date(s.scanned_at).toLocaleString()}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {s.finding_count} findings
                  </span>
                  {s.note && (
                    <span className="ml-2 truncate text-xs text-muted-foreground">
                      · {s.note}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm("Delete this scan and its findings?")) {
                      remove.mutate(s.id);
                    }
                  }}
                  className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3 w-3" /> Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-6">
        {findings.isLoading || scans.isLoading ? (
          <div className="h-32 animate-pulse rounded-xl border border-border/60 bg-card/60" />
        ) : allFindings.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
            No scans recorded yet. Click "Record scan" and paste the findings JSON from the
            security scanner to start building history.
          </div>
        ) : grouped.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
            No findings match your filters.
          </div>
        ) : (
          <ul className="space-y-3">
            {grouped.map((g) => {
              const isOpen = expanded[g.internal_id] ?? false;
              const latest = g.rows[0];
              return (
                <li
                  key={g.internal_id}
                  className="rounded-2xl border border-border/60 bg-card"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((prev) => ({ ...prev, [g.internal_id]: !isOpen }))
                    }
                    className="flex w-full items-start justify-between gap-3 p-4 text-left"
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="rounded bg-muted/40 px-1.5 py-0.5 text-xs">
                          {g.internal_id}
                        </code>
                        {latest?.level && (
                          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                            {latest.level}
                          </span>
                        )}
                        {latest?.state && (
                          <span className="rounded border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                            {latest.state}
                          </span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {g.rows.length} snapshot{g.rows.length === 1 ? "" : "s"}
                        </span>
                      </div>
                      <div className="mt-1 truncate font-medium">
                        {latest?.name || "(no name)"}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {latest?.scanner_name} · {latest?.category} · latest{" "}
                        {latest ? new Date(latest.scanned_at).toLocaleString() : ""}
                      </div>
                    </div>
                    <span className="mt-1 shrink-0 text-xs text-muted-foreground">
                      {isOpen ? "Hide" : "Show"} history
                    </span>
                  </button>
                  {isOpen && (
                    <div className="border-t border-border/60 p-4">
                      <DiffPanel latest={g.rows[0]} previous={g.rows[1]} />
                      <ol className="mt-4 space-y-3">
                        {g.rows.map((r, i) => {
                          const prev = g.rows[i + 1];
                          const changed = prev && prev.state !== r.state;
                          return (
                            <li
                              key={r.id}
                              className="rounded-lg border border-border/40 bg-background/40 p-3 text-sm"
                            >
                              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                <span>{new Date(r.scanned_at).toLocaleString()}</span>
                                {r.state && (
                                  <span
                                    className={`rounded px-1.5 py-0.5 font-semibold uppercase tracking-wider ${
                                      changed
                                        ? "bg-primary/20 text-primary"
                                        : "border border-border/60 text-muted-foreground"
                                    }`}
                                  >
                                    {r.state}
                                    {changed && prev ? ` (was ${prev.state})` : ""}
                                  </span>
                                )}
                                {r.level && <span>· {r.level}</span>}
                              </div>
                              {r.description && (
                                <p className="mt-2 whitespace-pre-wrap text-foreground/90">
                                  {r.description}
                                </p>
                              )}
                              {r.details && (
                                <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                                  {r.details}
                                </p>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {importing && (
        <ImportScanModal
          onCancel={() => setImporting(false)}
          onSave={async (payload) => {
            try {
              await createFn({ data: payload });
              toast.success("Scan recorded");
              setImporting(false);
              qc.invalidateQueries({ queryKey: ["security-scans"] });
              qc.invalidateQueries({ queryKey: ["security-scan-findings"] });
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Failed to record scan");
            }
          }}
        />
      )}
    </section>
  );
}

type ImportPayload = {
  note?: string;
  findings: Array<{
    internal_id: string;
    scanner_name: string;
    name: string;
    category: string;
    level: string;
    state: string;
    description: string;
    details: string;
  }>;
};

function ImportScanModal({
  onCancel,
  onSave,
}: {
  onCancel: () => void;
  onSave: (payload: ImportPayload) => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [raw, setRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-border/60 bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg">Record a security scan</h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 hover:bg-muted/40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Paste the findings array from the security scanner as JSON. Each item must
          include at least <code>internal_id</code>; other fields (name, level, state,
          description, details, scanner_name, category) are captured when present.
        </p>
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setError(null);
            let parsed: unknown;
            try {
              parsed = JSON.parse(raw);
            } catch (err) {
              setError("Invalid JSON");
              return;
            }
            const array = Array.isArray(parsed)
              ? parsed
              : parsed && typeof parsed === "object" && Array.isArray((parsed as { findings?: unknown }).findings)
                ? (parsed as { findings: unknown[] }).findings
                : null;
            if (!array) {
              setError('Expected an array of findings, or an object with a "findings" array.');
              return;
            }
            const findings: ImportPayload["findings"] = [];
            for (const item of array) {
              if (!item || typeof item !== "object") continue;
              const rec = item as Record<string, unknown>;
              const internal_id = typeof rec.internal_id === "string" ? rec.internal_id : "";
              if (!internal_id) continue;
              findings.push({
                internal_id,
                scanner_name: str(rec.scanner_name),
                name: str(rec.name),
                category: str(rec.category),
                level: str(rec.level),
                state: str(rec.state),
                description: str(rec.description),
                details: str(rec.details),
              });
            }
            if (findings.length === 0) {
              setError("No findings with an internal_id were found in the input.");
              return;
            }
            setSaving(true);
            try {
              await onSave({ note: note.trim() || undefined, findings });
            } finally {
              setSaving(false);
            }
          }}
        >
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Note (optional)
            </span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              placeholder="e.g. Weekly review, before deploy"
              className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Findings JSON
            </span>
            <textarea
              required
              rows={12}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder='[{"internal_id":"...","name":"...","level":"mid","state":"failing","description":"..."}]'
              className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 font-mono text-xs"
            />
          </label>
          {error && (
            <div role="alert" className="text-xs text-destructive">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border/60 px-4 py-2 text-sm hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Record scan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}
