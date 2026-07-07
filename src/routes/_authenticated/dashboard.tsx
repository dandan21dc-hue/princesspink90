import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listMyEvents, getMyEventsCompliance } from "@/lib/host.functions";
import { listMyRsvps } from "@/lib/rsvp.functions";
import { amIAdmin } from "@/lib/admin.functions";
import { NotificationsBell } from "@/components/NotificationsBell";
import { QuickAccessButton } from "@/components/QuickAccessScripts";
import { PerksWidget } from "@/components/PerksWidget";
import { SubscriberDiscountPanel } from "@/components/SubscriberDiscountPanel";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · AFTERDARK" }] }),
  component: Dashboard,
});

function Dashboard() {
  const myEventsFn = useServerFn(listMyEvents);
  const myRsvpsFn = useServerFn(listMyRsvps);
  const amIAdminFn = useServerFn(amIAdmin);
  const complianceFn = useServerFn(getMyEventsCompliance);
  const events = useQuery({ queryKey: ["my-events"], queryFn: () => myEventsFn() });
  const rsvps = useQuery({ queryKey: ["my-rsvps"], queryFn: () => myRsvpsFn() });
  const admin = useQuery({ queryKey: ["am-i-admin"], queryFn: () => amIAdminFn() });
  const compliance = useQuery({ queryKey: ["my-events-compliance"], queryFn: () => complianceFn() });


  return (
    <section className="mx-auto max-w-5xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Dashboard</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Your green room</h1>
        </div>
        <div className="flex items-center gap-2">
          <QuickAccessButton />
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
          <Link
            to="/support"
            className="rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
          >
            Support chat
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
                to="/admin/compliance-policy"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Policy editor
              </Link>
              <Link
                to="/admin/compliance-audit"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Audit log
              </Link>
              <Link
                to="/admin/health-purge"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Purge log
              </Link>
              <Link
                to="/admin/safety-incidents"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Incident log
              </Link>
              <Link
                to="/admin/venue-compliance"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Venue compliance
              </Link>
              <Link
                to="/admin/system-logs"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                System logs
              </Link>
              <Link
                to="/admin/health-reminders"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Reminder log
              </Link>
              <Link
                to="/admin/venue-compliance-reminders"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Venue reminder log
              </Link>
              <Link
                to="/admin/webhook-events"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Webhook events
              </Link>
              <Link
                to="/admin/analytics"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Tier analytics
              </Link>






              <Link
                to="/admin/lifetime"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Admin
              </Link>
              <Link
                to="/admin/perks"
                className="rounded-md border border-neon/40 bg-neon/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-neon hover:bg-neon/20"
              >
                Free-entry perks
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

      <div className="mt-10">
        <PerksWidget />
      </div>

      <div className="mt-6">
        <SubscriberDiscountPanel />
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
                  <div className="text-right">
                    <div className="font-display text-sm font-bold tracking-wide text-neon">“{r.entry_phrase}”</div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Entry phrase</div>
                  </div>
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

      <div className="mt-10 rounded-2xl border border-border/60 bg-card/60 p-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-primary shadow-[var(--shadow-glow-pink)]" />
          <div className="text-sm">
            <div className="font-display text-base">Health screenings — retention notice</div>
            <p className="mt-1.5 text-muted-foreground leading-relaxed">
              Screenings are only kept while they're useful, then purged
              automatically along with the underlying file:
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground leading-relaxed">
              <li>
                <span className="text-foreground">Approved screenings</span> are
                valid until the test's <em>valid until</em> date and purged the
                day after they expire.
              </li>
              <li>
                <span className="text-foreground">Pending submissions</span> that
                aren't reviewed within <span className="text-foreground">90 days</span>{" "}
                are purged automatically — re-upload if you still need one.
              </li>
              <li>
                <span className="text-foreground">Rejected submissions</span> are
                kept for 30 days after review, then purged.
              </li>
            </ul>
            <p className="mt-2 text-xs text-muted-foreground">
              Only a small audit record (date, status, reason) is retained after purge — never the file itself.
            </p>
          </div>
        </div>
      </div>

      <ComplianceChecklist
        isLoading={compliance.isLoading}
        data={compliance.data ?? []}
      />
    </section>
  );
}

type ComplianceItemStatus = "ok" | "missing" | "expired" | "expiring" | "unconfirmed";
type ComplianceEvent = {
  id: string;
  title: string;
  starts_at: string;
  venue_name: string | null;
  published: boolean;
  ready: boolean;
  items: {
    permit: { status: ComplianceItemStatus; file_name: string | null; uploaded_at: string | null };
    insurance: {
      status: ComplianceItemStatus;
      file_name: string | null;
      uploaded_at: string | null;
      expires_on: string | null;
    };
    capacity: {
      status: ComplianceItemStatus;
      file_name: string | null;
      uploaded_at: string | null;
      confirmed: boolean;
    };
  };
};

function ComplianceChecklist({ isLoading, data }: { isLoading: boolean; data: ComplianceEvent[] }) {
  return (
    <div className="mt-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Venue compliance</div>
          <h2 className="mt-2 font-display text-2xl font-semibold">Readiness checklist</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permit, insurance, and capacity documents required to publish each event.
          </p>
        </div>
        <Link
          to="/compliance"
          className="text-xs uppercase tracking-widest text-primary hover:underline"
        >
          Policy →
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-6"><Skeleton /></div>
      ) : data.length === 0 ? (
        <div className="mt-6"><Empty>Create an event to start the compliance checklist.</Empty></div>
      ) : (
        <ul className="mt-6 space-y-4">
          {data.map((e) => (
            <li key={e.id} className="rounded-xl border border-border/60 bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    to="/events/$id/edit" params={{ id: e.id }}
                    className="font-medium hover:text-primary"
                  >
                    {e.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.starts_at).toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    {e.venue_name ? ` · ${e.venue_name}` : ""}
                  </div>
                </div>
                <ReadinessBadge ready={e.ready} published={e.published} />
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <CheckRow
                  label="Permit"
                  status={e.items.permit.status}
                  detail={e.items.permit.file_name ?? "No document uploaded"}
                />
                <CheckRow
                  label="Insurance"
                  status={e.items.insurance.status}
                  detail={
                    e.items.insurance.file_name
                      ? e.items.insurance.expires_on
                        ? `Expires ${new Date(e.items.insurance.expires_on).toLocaleDateString()}`
                        : "No expiry on file"
                      : "No document uploaded"
                  }
                />
                <CheckRow
                  label="Capacity"
                  status={e.items.capacity.status}
                  detail={
                    e.items.capacity.file_name
                      ? e.items.capacity.confirmed
                        ? "Confirmed"
                        : "Awaiting confirmation"
                      : "No document uploaded"
                  }
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReadinessBadge({ ready, published }: { ready: boolean; published: boolean }) {
  if (ready) {
    return (
      <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-300">
        {published ? "Compliant · Live" : "Ready to publish"}
      </span>
    );
  }
  return (
    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-300">
      Action required
    </span>
  );
}

function CheckRow({ label, status, detail }: { label: string; status: ComplianceItemStatus; detail: string }) {
  const meta: Record<ComplianceItemStatus, { icon: string; tone: string; text: string }> = {
    ok: { icon: "✓", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300", text: "Up to date" },
    missing: { icon: "✕", tone: "border-red-500/40 bg-red-500/10 text-red-300", text: "Missing" },
    expired: { icon: "!", tone: "border-red-500/40 bg-red-500/10 text-red-300", text: "Expired" },
    expiring: { icon: "!", tone: "border-amber-500/40 bg-amber-500/10 text-amber-300", text: "Expiring soon" },
    unconfirmed: { icon: "…", tone: "border-amber-500/40 bg-amber-500/10 text-amber-300", text: "Not confirmed" },
  };
  const m = meta[status];
  return (
    <div className={`rounded-lg border px-3 py-2 ${m.tone}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest">{label}</span>
        <span className="font-mono text-xs">{m.icon} {m.text}</span>
      </div>
      <div className="mt-1 truncate text-[11px] opacity-80">{detail}</div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-widest">{children}</span>;
}
function Skeleton() { return <div className="h-24 rounded-xl bg-card animate-pulse" />; }
function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">{children}</div>;
}
