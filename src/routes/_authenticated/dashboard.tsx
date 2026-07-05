import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyEvents } from "@/lib/host.functions";
import { listMyRsvps } from "@/lib/rsvp.functions";
import { amIAdmin } from "@/lib/admin.functions";
import { NotificationsBell } from "@/components/NotificationsBell";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · AFTERDARK" }] }),
  component: Dashboard,
});

function Dashboard() {
  const myEventsFn = useServerFn(listMyEvents);
  const myRsvpsFn = useServerFn(listMyRsvps);
  const amIAdminFn = useServerFn(amIAdmin);
  const events = useQuery({ queryKey: ["my-events"], queryFn: () => myEventsFn() });
  const rsvps = useQuery({ queryKey: ["my-rsvps"], queryFn: () => myRsvpsFn() });
  const admin = useQuery({ queryKey: ["am-i-admin"], queryFn: () => amIAdminFn() });


  return (
    <section className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Dashboard</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Your green room</h1>
        </div>
        <div className="flex items-center gap-2">
          <NotificationsBell />
          <Link
            to="/verify"
            className="rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            Verify ID
          </Link>
          <Link
            to="/cohost-apply"
            className="rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            Co-host with me
          </Link>
          {admin.data?.isAdmin && (
            <>
              <Link
                to="/admin/settings"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Settings
              </Link>
              <Link
                to="/admin/verifications"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Verifications
              </Link>
              <Link
                to="/admin/cohosts"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Co-hosts
              </Link>
              <Link
                to="/admin/events-compliance"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Compliance
              </Link>
              <Link
                to="/admin/lifetime"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Admin
              </Link>
            </>
          )}
          <Link
            to="/content"
            className="rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            Manage content
          </Link>
          <Link
            to="/events/new"
            className="rounded-md bg-primary px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
          >
            + Host an event
          </Link>
        </div>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-2">
        <div>
          <h2 className="font-display text-lg mb-4">Your tickets</h2>
          {rsvps.isLoading ? <Skeleton /> : rsvps.data?.length ? (
            <ul className="space-y-3">
              {rsvps.data.map((r) => (
                <li key={r.id} className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4">
                  <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-secondary/40">
                    {r.events?.cover_image_url && (
                      <img src={r.events.cover_image_url} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.events?.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.events && new Date(r.events.starts_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {" · "}{r.events?.venue_name}
                    </div>
                  </div>
                  <div className="font-mono text-sm font-bold tracking-wider text-neon">{r.ticket_code}</div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No RSVPs yet. Browse the marquee.</Empty>
          )}
        </div>

        <div>
          <h2 className="font-display text-lg mb-4">Events you host</h2>
          {events.isLoading ? <Skeleton /> : events.data?.length ? (
            <ul className="space-y-3">
              {events.data.map((e) => (
                <li key={e.id}>
                  <Link
                    to="/events/$id/edit" params={{ id: e.id }}
                    className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 hover:border-primary/60 transition"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-secondary/40">
                      {e.cover_image_url && <img src={e.cover_image_url} alt="" className="h-full w-full object-cover" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(e.starts_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                        {" · "}{e.venue_name}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {e.is_private && <Badge>Private</Badge>}
                      {!e.published && <Badge>Draft</Badge>}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <Empty>You haven't hosted anything yet.</Empty>
          )}
        </div>
      </div>
    </section>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-widest">{children}</span>;
}
function Skeleton() { return <div className="h-24 rounded-xl bg-card animate-pulse" />; }
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">{children}</div>;
}
