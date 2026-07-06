import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { amIAdmin, listFreeEntryPerkMembers } from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/perks")({
  head: () => ({ meta: [{ title: "Free event-entry perks · Admin" }] }),
  component: AdminPerks,
});

function fmt(s: string | null | undefined) {
  if (!s) return "—";
  return new Date(s).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function AdminPerks() {
  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(listFreeEntryPerkMembers);
  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const q = useQuery({
    queryKey: ["admin-free-entry-perks"],
    queryFn: () => listFn(),
    enabled: me.data?.isAdmin === true,
  });

  if (me.isLoading) {
    return (
      <Shell>
        <p className="text-muted-foreground">Loading…</p>
      </Shell>
    );
  }
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don't have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">
            Back to dashboard
          </Link>
        </p>
      </Shell>
    );
  }

  const members = q.data?.members ?? [];
  const totals = q.data?.totals ?? { total: 0, redeemed: 0, unused: 0 };

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Free event-entry perks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            12-month term-pass &amp; lifetime members. Tracks whether the bundled free
            event entry has been redeemed.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        <SummaryTile label="Eligible members" value={totals.total} />
        <SummaryTile label="Redeemed" value={totals.redeemed} tone="used" />
        <SummaryTile label="Still unused" value={totals.unused} tone="available" />
      </div>

      {q.isLoading ? (
        <p className="mt-8 text-muted-foreground">Loading members…</p>
      ) : q.error ? (
        <p className="mt-8 text-destructive">Failed to load: {(q.error as Error).message}</p>
      ) : members.length === 0 ? (
        <p className="mt-8 text-muted-foreground">No qualifying members yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-border/60">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Purchased</th>
                <th className="px-4 py-3">Perk status</th>
                <th className="px-4 py-3">Redeemed event</th>
              </tr>
            </thead>
            <tbody>
              {members.map((m) => (
                <tr key={m.id} className="border-t border-border/40">
                  <td className="px-4 py-3">
                    <div className="font-medium">{m.display_name ?? "Unnamed"}</div>
                    <div className="text-xs text-muted-foreground truncate max-w-[220px]">
                      {m.email ?? m.user_id}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
                      {m.kind === "lifetime" ? "Lifetime" : "12-Month"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{fmt(m.purchased_at)}</td>
                  <td className="px-4 py-3">
                    {m.redeemed ? (
                      <span className="rounded-md border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                        Redeemed {fmt(m.redeemed_at)}
                      </span>
                    ) : (
                      <span className="rounded-md border border-neon/40 bg-neon/10 px-2 py-0.5 text-[11px] text-neon">
                        Available
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {m.redeemed_event ? (
                      <Link
                        to="/events/$id"
                        params={{ id: m.redeemed_event.id }}
                        className="text-primary underline"
                      >
                        {m.redeemed_event.title}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <section className="mx-auto max-w-5xl px-5 py-12">{children}</section>;
}

function SummaryTile({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "used" | "available";
}) {
  const toneCls =
    tone === "used"
      ? "border-primary/40 bg-primary/10 text-primary"
      : tone === "available"
      ? "border-neon/40 bg-neon/10 text-neon"
      : "border-border/60 bg-secondary/30 text-foreground";
  return (
    <div className={`rounded-lg border px-4 py-3 ${toneCls}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-70">{label}</div>
      <div className="mt-0.5 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}
