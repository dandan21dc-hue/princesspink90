import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { amIAdmin, adminListEventsCompliance } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/events-compliance")({
  head: () => ({ meta: [{ title: "Event compliance · Admin" }] }),
  component: AdminEventsCompliance,
});

type Status = "all" | "flagged" | "pending" | "approved";

function AdminEventsCompliance() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(adminListEventsCompliance);
  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const q = useQuery({
    queryKey: ["admin-events-compliance"],
    queryFn: () => listFn(),
    enabled: me.data?.isAdmin === true,
  });

  const [filter, setFilter] = useState<Status>("flagged");
  const [search, setSearch] = useState("");

  const rows = q.data?.rows ?? [];
  const summary = q.data?.summary;

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter !== "all" && r.status !== filter) return false;
      if (!s) return true;
      return (
        r.title.toLowerCase().includes(s) ||
        (r.venue_name ?? "").toLowerCase().includes(s) ||
        (r.city ?? "").toLowerCase().includes(s) ||
        (r.host_name ?? "").toLowerCase().includes(s)
      );
    });
  }, [rows, filter, search]);

  if (me.isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          No admin access. <Link to="/dashboard" className="text-primary underline">Back</Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      {summary && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <Stat label="Total" value={summary.total} tone="muted" onClick={() => setFilter("all")} active={filter === "all"} />
          <Stat label="Flagged" value={summary.flagged} tone="danger" onClick={() => setFilter("flagged")} active={filter === "flagged"} />
          <Stat label="Pending" value={summary.pending} tone="warn" onClick={() => setFilter("pending")} active={filter === "pending"} />
          <Stat label="Approved" value={summary.approved} tone="ok" onClick={() => setFilter("approved")} active={filter === "approved"} />
          <Stat label="Published" value={summary.published} tone="muted" />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, venue, host…"
          className="flex-1 min-w-[220px] rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <div className="flex gap-1">
          {(["flagged", "pending", "approved", "all"] as Status[]).map((s) => (
            <button key={s} type="button" onClick={() => setFilter(s)}
              className={`rounded-md border px-3 py-1.5 text-[11px] uppercase tracking-widest ${
                filter === s ? "border-primary text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground">No events match this filter.</p>
      ) : (
        <ul className="space-y-3">
          {filtered.map((r) => <Row key={r.id} row={r} />)}
        </ul>
      )}
    </Shell>
  );
}

function Row({ row }: { row: NonNullable<ReturnType<typeof useComplianceRows>>[number] }) {
  const [open, setOpen] = useState(false);
  const badge =
    row.status === "approved" ? { text: "Approved", cls: "bg-emerald-500/15 text-emerald-400" } :
    row.status === "flagged" ? { text: "Flagged", cls: "bg-red-500/15 text-red-400" } :
    { text: "Pending", cls: "bg-amber-500/15 text-amber-400" };

  const issues: string[] = [];
  if (row.missing_docs.length) issues.push(`Missing: ${row.missing_docs.join(", ")}`);
  if (row.missing_confirmations.length) issues.push(`Unconfirmed: ${row.missing_confirmations.join(", ")}`);
  if (row.insurance_status === "expired") issues.push("Insurance expired");
  else if (row.insurance_status === "expiring") issues.push("Insurance expires <30 days");
  else if (row.insurance_status === "unknown" && !row.missing_docs.includes("insurance")) issues.push("No insurance expiry set");
  if (row.capacity_over_limit) issues.push(`Capacity ${row.capacity} > legal ${row.legal_capacity}`);

  return (
    <li className="rounded-2xl border border-border/60 bg-card/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`text-[10px] uppercase tracking-widest px-1.5 py-0.5 rounded ${badge.cls}`}>{badge.text}</span>
            {row.published ? (
              <span className="text-[10px] uppercase tracking-widest text-primary">Published</span>
            ) : (
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Draft</span>
            )}
            {row.is_private && <span className="text-[10px] uppercase tracking-widest text-muted-foreground">Private</span>}
          </div>
          <h2 className="mt-1 font-display text-lg font-semibold truncate">{row.title}</h2>
          <div className="mt-0.5 text-xs text-muted-foreground truncate">
            {row.venue_name}{row.city ? ` · ${row.city}` : ""} · {new Date(row.starts_at).toLocaleString()}
            {row.host_name ? ` · Host: ${row.host_name}` : ""}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link
            to="/events/$id/edit" params={{ id: row.id }}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest hover:bg-secondary/50"
          >
            Open
          </Link>
          <button type="button" onClick={() => setOpen((v) => !v)}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest hover:bg-secondary/50">
            {open ? "Hide" : "Details"}
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[11px]">
        <Pill on={row.confirmations.permits} label="Permits" />
        <Pill on={row.confirmations.insurance} label="Insurance" />
        <Pill on={row.confirmations.capacity} label="Capacity" />
        <DocPill label="Permit doc" have={!row.missing_docs.includes("permit")} />
        <DocPill label="Insurance doc" have={!row.missing_docs.includes("insurance")} />
        <DocPill label="Capacity doc" have={!row.missing_docs.includes("capacity")} />
      </div>

      {issues.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-red-400">
          {issues.map((i) => <li key={i}>• {i}</li>)}
        </ul>
      )}

      {open && (
        <div className="mt-4 rounded-lg border border-border/50 p-4 text-xs space-y-2">
          <div><span className="text-muted-foreground">Insurance:</span> {row.insurance_provider ?? "—"} · expires {row.insurance_expires_on ?? "—"}</div>
          <div><span className="text-muted-foreground">Capacity:</span> {row.capacity ?? "—"} / legal {row.legal_capacity ?? "—"}</div>
          <div>
            <div className="text-muted-foreground mb-1">Documents on file ({row.docs_on_file.length}):</div>
            {row.docs_on_file.length === 0 ? (
              <div className="text-muted-foreground">None uploaded.</div>
            ) : (
              <ul className="space-y-0.5">
                {row.docs_on_file.map((d) => (
                  <li key={d.id}>
                    <span className="uppercase tracking-widest text-[10px] text-primary mr-2">{d.doc_type}</span>
                    <span>{d.file_name}</span>
                    <span className="text-muted-foreground"> · {new Date(d.uploaded_at).toLocaleDateString()}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

// Type helper so Row can reference the row shape without duplicating it.
function useComplianceRows() {
  const listFn = useServerFn(adminListEventsCompliance);
  const q = useQuery({ queryKey: ["admin-events-compliance"], queryFn: () => listFn() });
  return q.data?.rows;
}

function Pill({ on, label }: { on: boolean; label: string }) {
  return (
    <span className={`px-2 py-0.5 rounded uppercase tracking-widest text-[10px] ${
      on ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
    }`}>
      {label} {on ? "✓" : "!"}
    </span>
  );
}
function DocPill({ have, label }: { have: boolean; label: string }) {
  return (
    <span className={`px-2 py-0.5 rounded uppercase tracking-widest text-[10px] ${
      have ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
    }`}>
      {label} {have ? "✓" : "missing"}
    </span>
  );
}
function Stat({ label, value, tone, onClick, active }: {
  label: string; value: number; tone: "ok" | "warn" | "danger" | "muted";
  onClick?: () => void; active?: boolean;
}) {
  const toneCls =
    tone === "ok" ? "text-emerald-400" :
    tone === "warn" ? "text-amber-400" :
    tone === "danger" ? "text-red-400" :
    "text-foreground";
  return (
    <button type="button" disabled={!onClick} onClick={onClick}
      className={`rounded-2xl border p-4 text-left transition ${
        active ? "border-primary" : "border-border/60"
      } ${onClick ? "hover:bg-secondary/40 cursor-pointer" : "cursor-default"}`}>
      <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-display text-2xl font-semibold ${toneCls}`}>{value}</div>
    </button>
  );
}
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl px-5 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Event compliance</h1>
        <Link to="/dashboard" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>
      {children}
    </main>
  );
}
