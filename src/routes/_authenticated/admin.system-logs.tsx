import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { amIAdmin } from "@/lib/admin.functions";
import { getSystemLogs, type SystemLogEvent } from "@/lib/system-logs.functions";

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
            A bird's-eye view of platform activity. Auto-refreshes every 30 seconds.
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
              <li key={ev.id} className="flex items-start gap-4 px-5 py-4">
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
    </section>
  );
}
