import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  Home,
  Ticket,
  ShieldCheck,
  Users,
  MessageCircle,
  UserCog,
  UsersRound,
  BadgeCheck,
  Crown,
  Package,
  FileText,
  CalendarDays,
  Gift,
  PartyPopper,
  ClipboardCheck,
  Scale,
  Building2,
  ScrollText,
  Trash2,
  AlertTriangle,
  Webhook,
  Terminal,
  BellRing,
  BarChart3,
  MapPin,
  ChevronDown,

} from "lucide-react";
import { listMyEvents, getMyEventsCompliance } from "@/lib/host.functions";
import { listMyRsvps } from "@/lib/rsvp.functions";
import { amIAdmin } from "@/lib/admin.functions";
import { listMapPins } from "@/lib/map-pins.functions";
import { NotificationsBell } from "@/components/NotificationsBell";
import { QuickAccessButton } from "@/components/QuickAccessScripts";
import { PerksWidget } from "@/components/PerksWidget";
import { SubscriberDiscountPanel } from "@/components/SubscriberDiscountPanel";
import { RoleGuard } from "@/components/RoleGuard";
import { AddVenuePinDialog } from "@/components/AddVenuePinDialog";
import { MapPinsMap } from "@/components/MapPinsMap";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard · AFTERDARK" }] }),
  component: DashboardGuarded,
});

function DashboardGuarded() {
  return (
    <RoleGuard allowedRoles={["admin", "co_host"]}>
      <Dashboard />
    </RoleGuard>
  );
}

type NavItem = { label: string; to: string; icon: React.ComponentType<{ className?: string }>; adminOnly?: boolean };
type NavGroup = { id: string; label: string; items: NavItem[]; adminOnly?: boolean };

const GROUPS: NavGroup[] = [
  {
    id: "personal",
    label: "Personal",
    items: [
      { label: "My Bookings", to: "/bookings", icon: Ticket },
      { label: "My Orders", to: "/account/orders", icon: ScrollText },
      { label: "Verify ID", to: "/verify", icon: ShieldCheck },
      { label: "Co-Host With Me", to: "/cohost-apply", icon: Users },
      { label: "Support Chat", to: "/support", icon: MessageCircle },
    ],
  },
  {
    id: "admin",
    label: "Admin & Users",
    adminOnly: true,
    items: [
      { label: "User Management", to: "/admin/user-management", icon: UserCog, adminOnly: true },
      { label: "Co-Hosts", to: "/admin/cohosts", icon: UsersRound, adminOnly: true },
      { label: "Verifications", to: "/admin/verifications", icon: BadgeCheck, adminOnly: true },
      { label: "Admin", to: "/admin/lifetime", icon: Crown, adminOnly: true },
      { label: "Manual All-Access", to: "/admin/all-access", icon: Crown, adminOnly: true },
    ],
  },
  {
    id: "content",
    label: "Content & Store",
    items: [
      { label: "Inventory Manager", to: "/admin/panty-listings", icon: Package, adminOnly: true },
      { label: "Manage Content", to: "/content", icon: FileText },
      { label: "Availability Manager", to: "/admin/availability", icon: CalendarDays, adminOnly: true },
      { label: "Secondary Room Sessions", to: "/admin/secondary-room-sessions", icon: CalendarDays, adminOnly: true },
      { label: "Free-Entry Perks", to: "/admin/perks", icon: Gift, adminOnly: true },
      { label: "Map Pins / Venues", to: "/admin/map-pins", icon: MapPin, adminOnly: true },
      { label: "Host an Event", to: "/events/new", icon: PartyPopper },

    ],
  },
  {
    id: "compliance",
    label: "Compliance & Safety",
    adminOnly: true,
    items: [
      { label: "Compliance", to: "/admin/events-compliance", icon: ClipboardCheck, adminOnly: true },
      { label: "Policy Editor", to: "/admin/compliance-policy", icon: Scale, adminOnly: true },
      { label: "Venue Compliance", to: "/admin/venue-compliance", icon: Building2, adminOnly: true },
    ],
  },
  {
    id: "system",
    label: "System & Logs",
    adminOnly: true,
    items: [
      { label: "Audit Log", to: "/admin/compliance-audit", icon: ScrollText, adminOnly: true },
      { label: "Purge Log", to: "/admin/health-purge", icon: Trash2, adminOnly: true },
      { label: "Incident Log", to: "/admin/safety-incidents", icon: AlertTriangle, adminOnly: true },
      { label: "Webhook Events", to: "/admin/webhook-events", icon: Webhook, adminOnly: true },
      { label: "System Logs", to: "/admin/system-logs", icon: Terminal, adminOnly: true },
      { label: "Reminder Logs", to: "/admin/health-reminders", icon: BellRing, adminOnly: true },
      { label: "Tier Analytics", to: "/admin/analytics", icon: BarChart3, adminOnly: true },
    ],
  },
];

function Dashboard() {
  const amIAdminFn = useServerFn(amIAdmin);
  const admin = useQuery({ queryKey: ["am-i-admin"], queryFn: () => amIAdminFn() });
  const isAdmin = !!admin.data?.isAdmin;

  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    personal: true,
    admin: false,
    content: false,
    compliance: false,
    system: false,
  });

  const toggle = (id: string) => setOpenGroups((s) => ({ ...s, [id]: !s[id] }));

  return (
    <section className="mx-auto max-w-7xl px-5 py-10">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Dashboard</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Your green room</h1>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && <AddVenuePinDialog />}
          <QuickAccessButton />
          <NotificationsBell />
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-border/60 bg-card/60 p-3 lg:sticky lg:top-6 lg:self-start">
          <NavButton to="/dashboard" icon={Home} label="Home" exact />
          <div className="mt-2 space-y-1">
            {GROUPS.filter((g) => !g.adminOnly || isAdmin).map((g) => {
              const items = g.items.filter((i) => !i.adminOnly || isAdmin);
              if (items.length === 0) return null;
              const open = openGroups[g.id];
              return (
                <div key={g.id}>
                  <button
                    onClick={() => toggle(g.id)}
                    className="flex w-full items-center justify-between rounded-md px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                  >
                    <span>{g.label}</span>
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`} />
                  </button>
                  {open && (
                    <div className="mt-1 space-y-0.5 pl-1">
                      {items.map((i) => (
                        <NavButton key={i.to} to={i.to} icon={i.icon} label={i.label} />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <main className="min-w-0">
          <HomeView />
        </main>
      </div>
    </section>
  );
}

function NavButton({
  to,
  icon: Icon,
  label,
  exact,
}: {
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  exact?: boolean;
}) {
  return (
    <Link
      to={to}
      activeOptions={{ exact }}
      className="group flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-foreground/80 hover:bg-primary/10 hover:text-primary data-[status=active]:bg-primary/15 data-[status=active]:text-primary"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="truncate">{label}</span>
    </Link>
  );
}

function HomeView() {
  const myEventsFn = useServerFn(listMyEvents);
  const myRsvpsFn = useServerFn(listMyRsvps);
  const complianceFn = useServerFn(getMyEventsCompliance);
  const events = useQuery({ queryKey: ["my-events"], queryFn: () => myEventsFn() });
  const rsvps = useQuery({ queryKey: ["my-rsvps"], queryFn: () => myRsvpsFn() });
  const compliance = useQuery({ queryKey: ["my-events-compliance"], queryFn: () => complianceFn() });

  return (
    <div className="space-y-8">
      <PerksWidget />
      <SubscriberDiscountPanel />

      <div className="grid gap-8 xl:grid-cols-2">
        <div>
          <h2 className="mb-4 font-display text-lg">Your tickets</h2>
          {rsvps.isLoading ? (
            <Skeleton />
          ) : rsvps.data?.length ? (
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
                      {r.events &&
                        new Date(r.events.starts_at).toLocaleString(undefined, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      {" · "}
                      {r.events?.venue_name}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-display text-sm font-bold tracking-wide text-neon">"{r.entry_phrase}"</div>
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
          <h2 className="mb-4 font-display text-lg">Events you host</h2>
          {events.isLoading ? (
            <Skeleton />
          ) : events.data?.length ? (
            <ul className="space-y-3">
              {events.data.map((e) => (
                <li key={e.id}>
                  <Link
                    to="/events/$id/edit"
                    params={{ id: e.id }}
                    className="flex items-center gap-4 rounded-xl border border-border/60 bg-card p-4 transition hover:border-primary/60"
                  >
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md bg-secondary/40">
                      {e.cover_image_url && (
                        <img src={e.cover_image_url} alt="" className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{e.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(e.starts_at).toLocaleString(undefined, {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {" · "}
                        {e.venue_name}
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

      <ComplianceChecklist isLoading={compliance.isLoading} data={compliance.data ?? []} />
    </div>
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
    <div>
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Venue compliance</div>
          <h2 className="mt-2 font-display text-2xl font-semibold">Readiness checklist</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Permit, insurance, and capacity documents required to publish each event.
          </p>
        </div>
        <Link to="/compliance" className="text-xs uppercase tracking-widest text-primary hover:underline">
          Policy →
        </Link>
      </div>

      {isLoading ? (
        <div className="mt-6">
          <Skeleton />
        </div>
      ) : data.length === 0 ? (
        <div className="mt-6">
          <Empty>Create an event to start the compliance checklist.</Empty>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {data.map((e) => (
            <li key={e.id} className="rounded-xl border border-border/60 bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link to="/events/$id/edit" params={{ id: e.id }} className="font-medium hover:text-primary">
                    {e.title}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {new Date(e.starts_at).toLocaleString(undefined, {
                      day: "numeric",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
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
        <span className="font-mono text-xs">
          {m.icon} {m.text}
        </span>
      </div>
      <div className="mt-1 truncate text-[11px] opacity-80">{detail}</div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border/70 px-2 py-0.5 text-[10px] uppercase tracking-widest">
      {children}
    </span>
  );
}
function Skeleton() {
  return <div className="h-24 animate-pulse rounded-xl bg-card" />;
}
function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
