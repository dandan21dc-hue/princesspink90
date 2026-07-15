import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  listAllUsersForCrm,
  getCrmUserDetail,
  updateCrmStaffNotes,
  setCrmAccountRestricted,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/crm")({
  head: () => ({
    meta: [
      { title: "CRM · Admin · AFTERDARK" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CrmPage,
});

type UserRow = {
  id: string;
  email: string | null;
  created_at: string | null;
  display_name: string | null;
  account_restricted: boolean;
};

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function money(cents: number | null | undefined, currency = "AUD") {
  if (cents == null) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
}

function CrmPage() {
  const listFn = useServerFn(listAllUsersForCrm);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const usersQ = useQuery({
    queryKey: ["admin", "crm-users"],
    queryFn: () => listFn(),
  });

  const rows: UserRow[] = usersQ.data?.users ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        (r.email ?? "").toLowerCase().includes(q) ||
        (r.display_name ?? "").toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <section className="mx-auto max-w-7xl px-5 py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">CRM</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Registered members, their booking history, internal staff notes, and account restrictions.
          </p>
        </div>
        <Link
          to="/dashboard"
          className="rounded-md border border-primary/40 bg-primary/10 px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
        >
          ← Dashboard
        </Link>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        {/* List */}
        <div className="rounded-xl border border-border/60 bg-card">
          <div className="border-b border-border/60 p-3">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by email, name, or id"
              className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <div className="mt-2 text-xs text-muted-foreground">
              {filtered.length} of {rows.length} users
            </div>
          </div>
          <div className="max-h-[70vh] overflow-y-auto">
            {usersQ.isLoading ? (
              <div className="p-10 text-center text-sm text-muted-foreground">Loading users…</div>
            ) : usersQ.isError ? (
              <div className="p-10 text-center text-sm text-red-400">
                Failed to load users. {(usersQ.error as Error)?.message ?? ""}
              </div>
            ) : filtered.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">No users match.</div>
            ) : (
              <ul>
                {filtered.map((u) => {
                  const active = u.id === selectedId;
                  return (
                    <li key={u.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(u.id)}
                        className={`flex w-full items-start justify-between gap-3 border-t border-border/40 px-4 py-3 text-left first:border-t-0 hover:bg-secondary/30 ${
                          active ? "bg-secondary/40" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {u.display_name || u.email || u.id}
                          </div>
                          {u.email && u.display_name && (
                            <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                          )}
                          <div className="mt-1 text-[10px] text-muted-foreground/70">
                            Joined {fmtDate(u.created_at)}
                          </div>
                        </div>
                        {u.account_restricted && (
                          <span className="shrink-0 rounded-full border border-red-500/50 bg-red-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-red-400">
                            Restricted
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Detail */}
        <div className="rounded-xl border border-border/60 bg-card p-5">
          {selectedId ? (
            <UserDetail userId={selectedId} />
          ) : (
            <div className="flex h-full min-h-[300px] items-center justify-center text-sm text-muted-foreground">
              Select a user to view their booking history and notes.
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function UserDetail({ userId }: { userId: string }) {
  const qc = useQueryClient();
  const detailFn = useServerFn(getCrmUserDetail);
  const notesFn = useServerFn(updateCrmStaffNotes);
  const restrictFn = useServerFn(setCrmAccountRestricted);

  const detailQ = useQuery({
    queryKey: ["admin", "crm-user", userId],
    queryFn: () => detailFn({ data: { userId } }),
  });

  const [notes, setNotes] = useState("");
  useEffect(() => {
    if (detailQ.data) setNotes(detailQ.data.user.staff_notes ?? "");
  }, [detailQ.data]);

  const saveNotes = useMutation({
    mutationFn: () => notesFn({ data: { userId, staff_notes: notes } }),
    onSuccess: () => {
      toast.success("Staff notes saved");
      qc.invalidateQueries({ queryKey: ["admin", "crm-user", userId] });
    },
    onError: (e: Error) => toast.error(e?.message ?? "Failed to save notes"),
  });

  const toggleRestriction = useMutation({
    mutationFn: (restricted: boolean) => restrictFn({ data: { userId, restricted } }),
    onSuccess: (_r, restricted) => {
      toast.success(restricted ? "Account restricted" : "Account restriction removed");
      qc.invalidateQueries({ queryKey: ["admin", "crm-user", userId] });
      qc.invalidateQueries({ queryKey: ["admin", "crm-users"] });
    },
    onError: (e: Error) => toast.error(e?.message ?? "Failed to update restriction"),
  });

  if (detailQ.isLoading) {
    return <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  }
  if (detailQ.isError || !detailQ.data) {
    return (
      <div className="p-10 text-center text-sm text-red-400">
        Failed to load user. {(detailQ.error as Error)?.message ?? ""}
      </div>
    );
  }

  const { user, rsvps, room_bookings, panty_orders, memberships } = detailQ.data;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border/40 pb-4">
        <div className="min-w-0">
          <h2 className="truncate font-display text-2xl font-semibold">
            {user.display_name || user.email || user.id}
          </h2>
          {user.email && <div className="text-sm text-muted-foreground">{user.email}</div>}
          <div className="mt-1 font-mono text-[10px] text-muted-foreground/70">{user.id}</div>
          <div className="mt-1 text-xs text-muted-foreground">Joined {fmtDate(user.created_at)}</div>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-md border border-border/60 bg-background px-3 py-2">
          <input
            type="checkbox"
            checked={user.account_restricted}
            disabled={toggleRestriction.isPending}
            onChange={(e) => toggleRestriction.mutate(e.target.checked)}
            className="h-4 w-4 accent-red-500"
          />
          <span className="text-xs font-semibold uppercase tracking-widest">
            Account Restriction
          </span>
        </label>
      </header>

      {user.account_restricted && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          This member cannot complete bookings or checkouts. They'll see: "Please contact support to
          update your account status."
        </div>
      )}

      <section>
        <h3 className="mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Internal Staff Notes
        </h3>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={5}
          maxLength={10000}
          placeholder="Only admins can see these notes."
          className="w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[10px] text-muted-foreground">{notes.length}/10000</span>
          <button
            type="button"
            onClick={() => saveNotes.mutate()}
            disabled={saveNotes.isPending || notes === (user.staff_notes ?? "")}
            className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20 disabled:opacity-50"
          >
            {saveNotes.isPending ? "Saving…" : "Save notes"}
          </button>
        </div>
      </section>

      <BookingHistory
        rsvps={rsvps}
        roomBookings={room_bookings}
        pantyOrders={panty_orders}
        memberships={memberships}
      />
    </div>
  );
}

function BookingHistory({
  rsvps,
  roomBookings,
  pantyOrders,
  memberships,
}: {
  rsvps: any[];
  roomBookings: any[];
  pantyOrders: any[];
  memberships: any[];
}) {
  return (
    <section className="space-y-6">
      <h3 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
        Booking history
      </h3>

      <Group title={`Event RSVPs (${rsvps.length})`}>
        {rsvps.length === 0 ? (
          <Empty>No RSVPs.</Empty>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Event</th>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Guests</th>
                <th className="py-1 pr-3">Entry code</th>
                <th className="py-1">Checked in</th>
              </tr>
            </thead>
            <tbody>
              {rsvps.map((r) => (
                <tr key={r.id} className="border-t border-border/30">
                  <td className="py-1.5 pr-3">{r.events?.title ?? "—"}</td>
                  <td className="py-1.5 pr-3">{fmtDate(r.events?.starts_at ?? r.created_at)}</td>
                  <td className="py-1.5 pr-3">{r.guest_count ?? 1}</td>
                  <td className="py-1.5 pr-3 font-mono">{r.entry_code ?? "—"}</td>
                  <td className="py-1.5">{r.checked_in_at ? fmtDate(r.checked_in_at) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>

      <Group title={`Private room bookings (${roomBookings.length})`}>
        {roomBookings.length === 0 ? (
          <Empty>No private room bookings.</Empty>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Start</th>
                <th className="py-1 pr-3">Duration</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {roomBookings.map((b) => (
                <tr key={b.id} className="border-t border-border/30">
                  <td className="py-1.5 pr-3">{fmtDate(b.starts_at)}</td>
                  <td className="py-1.5 pr-3">{b.duration_minutes} min</td>
                  <td className="py-1.5 pr-3">{b.status}</td>
                  <td className="py-1.5">{money(b.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>

      <Group title={`Panty orders (${pantyOrders.length})`}>
        {pantyOrders.length === 0 ? (
          <Empty>No panty orders.</Empty>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Variant</th>
                <th className="py-1 pr-3">Placed</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {pantyOrders.map((o) => (
                <tr key={o.id} className="border-t border-border/30">
                  <td className="py-1.5 pr-3">{o.variant}</td>
                  <td className="py-1.5 pr-3">{fmtDate(o.created_at)}</td>
                  <td className="py-1.5 pr-3">{o.status}</td>
                  <td className="py-1.5">{money(o.amount_cents, (o.currency ?? "AUD").toUpperCase())}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>

      <Group title={`Memberships (${memberships.length})`}>
        {memberships.length === 0 ? (
          <Empty>No memberships.</Empty>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1 pr-3">Kind</th>
                <th className="py-1 pr-3">Env</th>
                <th className="py-1 pr-3">Expires</th>
                <th className="py-1">Amount</th>
              </tr>
            </thead>
            <tbody>
              {memberships.map((m) => (
                <tr key={m.id} className="border-t border-border/30">
                  <td className="py-1.5 pr-3">{m.kind}</td>
                  <td className="py-1.5 pr-3">{m.environment}</td>
                  <td className="py-1.5 pr-3">
                    {m.revoked_at
                      ? `revoked ${fmtDate(m.revoked_at)}`
                      : m.suspended_at
                        ? `suspended ${fmtDate(m.suspended_at)}`
                        : m.expires_at
                          ? fmtDate(m.expires_at)
                          : "—"}
                  </td>
                  <td className="py-1.5">{money(m.amount_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Group>
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border/40 p-3">
      <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-2 text-xs text-muted-foreground">{children}</div>;
}
