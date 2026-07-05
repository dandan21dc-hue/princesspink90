import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { amIAdmin } from "@/lib/admin.functions";
import {
  getSystemLogs,
  getSystemLogDetail,
  type SystemLogEvent,
} from "@/lib/system-logs.functions";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const Route = createFileRoute("/_authenticated/admin/system-logs")({
  head: () => ({ meta: [{ title: "System logs · Admin" }] }),
  component: AdminSystemLogs,
});

const KIND_STYLE: Record<SystemLogEvent["kind"], string> = {
  rsvp: "border-primary/40 bg-primary/10 text-primary",
  health_approved: "border-neon/40 bg-neon/10 text-neon",
  cohost_applied: "border-blue-500/40 bg-blue-500/10 text-blue-300",
  incident: "border-red-500/50 bg-red-500/10 text-red-300",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const secs = Math.max(1, Math.floor((now - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

function parseRef(id: string): { kind: SystemLogEvent["kind"]; rowId: string } | null {
  const [prefix, ...rest] = id.split("-");
  const rowId = rest.join("-");
  const map: Record<string, SystemLogEvent["kind"]> = {
    rsvp: "rsvp",
    health: "health_approved",
    cohost: "cohost_applied",
    incident: "incident",
  };
  const kind = map[prefix];
  if (!kind || !rowId) return null;
  return { kind, rowId };
}

function AdminSystemLogs() {
  const meFn = useServerFn(amIAdmin);
  const logsFn = useServerFn(getSystemLogs);

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const logs = useQuery({
    queryKey: ["admin-system-logs"],
    queryFn: () => logsFn(),
    enabled: me.data?.isAdmin === true,
    refetchInterval: 30_000,
  });

  const [selected, setSelected] = useState<SystemLogEvent | null>(null);

  if (me.isLoading) {
    return <section className="mx-auto max-w-5xl px-5 py-12 text-muted-foreground">Loading…</section>;
  }
  if (!me.data?.isAdmin) {
    return (
      <section className="mx-auto max-w-5xl px-5 py-12">
        <h1 className="font-display text-2xl">Admins only</h1>
        <Link to="/dashboard" className="mt-4 inline-block text-primary underline">Back to dashboard</Link>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">System Logs</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            A bird's-eye view of platform activity. Click a row to see the full
            payload. Auto-refreshes every 30 seconds.
          </p>
        </div>
        <button
          onClick={() => logs.refetch()}
          disabled={logs.isFetching}
          className="rounded-md border border-border px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          {logs.isFetching ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <div className="mt-8 rounded-xl border border-border/60 bg-card">
        {logs.isLoading ? (
          <p className="p-6 text-sm text-muted-foreground">Loading events…</p>
        ) : logs.isError ? (
          <p className="p-6 text-sm text-red-300">{(logs.error as Error).message}</p>
        ) : !logs.data || logs.data.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">No activity yet.</p>
        ) : (
          <ul className="divide-y divide-border/60">
            {logs.data.map((ev) => (
              <li key={ev.id}>
                <button
                  type="button"
                  onClick={() => setSelected(ev)}
                  className="flex w-full items-start gap-4 px-5 py-4 text-left transition hover:bg-primary/5 focus:bg-primary/5 focus:outline-none"
                >
                  <span
                    className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest ${KIND_STYLE[ev.kind]}`}
                  >
                    {ev.label}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-foreground">{ev.detail}</div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {timeAgo(ev.at)} · {new Date(ev.at).toLocaleString()}
                    </div>
                  </div>
                  <span className="shrink-0 self-center text-xs text-muted-foreground">
                    View →
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Link
        to="/dashboard"
        className="mt-8 inline-block text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        ← Back to dashboard
      </Link>

      <DetailSheet event={selected} onClose={() => setSelected(null)} />
    </section>
  );
}

function DetailSheet({
  event,
  onClose,
}: {
  event: SystemLogEvent | null;
  onClose: () => void;
}) {
  const detailFn = useServerFn(getSystemLogDetail);
  const ref = event ? parseRef(event.id) : null;
  const detail = useQuery({
    queryKey: ["admin-system-log-detail", event?.id],
    queryFn: () => detailFn({ data: { kind: ref!.kind, id: ref!.rowId } }),
    enabled: !!event && !!ref,
  });

  const payload = detail.data?.payload ?? null;

  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {event && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-3">
                <span
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-widest ${KIND_STYLE[event.kind]}`}
                >
                  {event.label}
                </span>
              </div>
              <SheetTitle className="font-display text-2xl">
                {detail.data?.summary ?? event.detail}
              </SheetTitle>
              <SheetDescription>
                {timeAgo(event.at)} · {new Date(event.at).toLocaleString()}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              {detail.isLoading && (
                <p className="text-sm text-muted-foreground">Loading payload…</p>
              )}
              {detail.isError && (
                <p className="text-sm text-red-300">
                  {(detail.error as Error).message}
                </p>
              )}
              {payload && (
                <>
                  <div className="rounded-lg border border-border/60 bg-background/60 p-4">
                    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Fields
                    </div>
                    <dl className="mt-3 grid gap-2 text-sm">
                      {Object.entries(payload).map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[9rem_1fr] gap-3">
                          <dt className="truncate font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                            {k}
                          </dt>
                          <dd className="min-w-0 break-words text-foreground">
                            {formatValue(v)}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  <details className="rounded-lg border border-border/60 bg-background/60 p-4">
                    <summary className="cursor-pointer text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      Raw JSON
                    </summary>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-black/60 p-3 text-[11px] leading-relaxed text-foreground/90">
                      {JSON.stringify(payload, null, 2)}
                    </pre>
                  </details>
                </>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function formatValue(v: unknown): React.ReactNode {
  if (v === null || v === undefined) {
    return <span className="text-muted-foreground/70">—</span>;
  }
  if (typeof v === "boolean") {
    return v ? "true" : "false";
  }
  if (typeof v === "number") return String(v);
  if (typeof v === "string") {
    // Detect ISO date-ish strings for friendlier rendering
    if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toLocaleString();
    }
    return v;
  }
  return (
    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-foreground/90">
      {JSON.stringify(v, null, 2)}
    </pre>
  );
}
