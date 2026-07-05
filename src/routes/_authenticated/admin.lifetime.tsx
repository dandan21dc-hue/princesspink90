import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listLifetimeMembers, amIAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/lifetime")({
  head: () => ({ meta: [{ title: "Lifetime members · Admin" }] }),
  component: AdminLifetime,
});

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AdminLifetime() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(listLifetimeMembers);
  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const q = useQuery({
    queryKey: ["admin-lifetime-members"],
    queryFn: () => listFn(),
    enabled: me.data?.isAdmin === true,
  });

  if (me.isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don't have admin access. <Link to="/dashboard" className="text-primary underline">Back to dashboard</Link>
        </p>
      </Shell>
    );
  }

  const members = q.data?.members ?? [];

  return (
    <Shell>
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Lifetime members</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {members.length} total · $499 one-time tier
          </p>
        </div>
        <Link to="/dashboard" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>

      {q.isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading members…</p>
      ) : q.error ? (
        <p className="mt-8 text-destructive">Failed to load: {(q.error as Error).message}</p>
      ) : members.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No lifetime members yet.</p>
      ) : (
        <div className="mt-8 space-y-4">
          {members.map((m) => {
            const used = Boolean(m.event_ticket_used_at);
            return (
              <div key={m.id} className="rounded-xl border border-border/60 bg-card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-display text-lg font-medium">
                      {m.display_name ?? "Unnamed member"}
                    </div>
                    <div className="text-xs text-muted-foreground truncate">{m.email ?? m.user_id}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>Purchased {fmtDate(m.purchased_at)}</div>
                    {m.amount_cents != null && (
                      <div className="text-neon">${(m.amount_cents / 100).toFixed(2)}</div>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3 text-sm">
                  <Stat
                    label="Free event ticket"
                    value={
                      used
                        ? `Used ${fmtDate(m.event_ticket_used_at)}${
                            m.event_ticket_event ? ` — ${m.event_ticket_event.title}` : ""
                          }`
                        : "Not used"
                    }
                    tone={used ? "used" : "available"}
                  />
                  <Stat
                    label="Private session"
                    value={
                      m.private_session_fulfilled_at
                        ? `Fulfilled ${fmtDate(m.private_session_fulfilled_at)}`
                        : m.private_session_requested_at
                        ? `Requested ${fmtDate(m.private_session_requested_at)}`
                        : "Not requested"
                    }
                    tone={
                      m.private_session_fulfilled_at
                        ? "used"
                        : m.private_session_requested_at
                        ? "pending"
                        : "available"
                    }
                  />
                  <Stat
                    label="Content access"
                    value="All content (lifetime)"
                    tone="used"
                  />
                </div>

                {m.one_time_purchases.length > 0 && (
                  <div className="mt-4">
                    <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
                      One-time purchases ({m.one_time_purchases.length})
                    </div>
                    <ul className="space-y-1 text-sm">
                      {m.one_time_purchases.map((p: any) => (
                        <li key={p.content_item_id} className="flex justify-between gap-4 text-muted-foreground">
                          <span className="truncate">
                            {p.content_items?.title ?? "Untitled"}
                            {p.content_items?.kind && (
                              <span className="ml-2 text-xs uppercase tracking-widest opacity-60">
                                {p.content_items.kind}
                              </span>
                            )}
                          </span>
                          <span className="shrink-0 text-xs">{fmtDate(p.created_at)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-5xl px-5 py-12">{children}</section>;
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "used" | "available" | "pending" }) {
  const toneCls =
    tone === "used"
      ? "border-primary/40 bg-primary/10 text-primary"
      : tone === "pending"
      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-400"
      : "border-border/60 bg-secondary/30 text-muted-foreground";
  return (
    <div className={`rounded-lg border px-3 py-2 ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}
