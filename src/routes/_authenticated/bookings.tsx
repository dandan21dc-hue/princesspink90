import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, addDays, startOfDay } from "date-fns";
import {
  listMyPrivateRoomBookings,
  cancelMyPrivateRoomBooking,
  rescheduleMyPrivateRoomBooking,
  listPrivateRoomBusy,
} from "@/lib/store.functions";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/bookings")({
  head: () => ({ meta: [{ title: "My Bookings · Princess Pink" }] }),
  component: BookingsPage,
  errorComponent: ({ error }) => (
    <div className="mx-auto max-w-3xl px-5 py-12 text-sm text-destructive">
      Failed to load bookings: {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

const DAY_START_HOUR = 10;
const DAY_END_HOUR = 22;
const SLOT_STEP_MIN = 30;

type Booking = {
  id: string;
  starts_at: string;
  duration_minutes: number;
  status: string;
  amount_cents: number | null;
  currency: string;
  party_size: number | null;
  notes: string | null;
  customer_email: string | null;
  created_at: string;
};

function BookingsPage() {
  const listFn = useServerFn(listMyPrivateRoomBookings);
  const cancelFn = useServerFn(cancelMyPrivateRoomBooking);
  const rescheduleFn = useServerFn(rescheduleMyPrivateRoomBooking);
  const qc = useQueryClient();
  const bookings = useQuery({
    queryKey: ["my-private-room-bookings"],
    queryFn: () => listFn(),
  });

  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelFn({ data: { id } }),
    onSuccess: () => {
      setSuccess("Booking cancelled.");
      setError(null);
      setConfirmCancelId(null);
      qc.invalidateQueries({ queryKey: ["my-private-room-bookings"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setSuccess(null);
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: (v: { id: string; startsAt: string }) => rescheduleFn({ data: v }),
    onSuccess: () => {
      setSuccess("Booking rescheduled.");
      setError(null);
      setReschedulingId(null);
      qc.invalidateQueries({ queryKey: ["my-private-room-bookings"] });
    },
    onError: (e: Error) => {
      setError(e.message);
      setSuccess(null);
    },
  });

  const rows: Booking[] = (bookings.data ?? []) as Booking[];
  const upcoming = rows.filter(
    (b) => b.status !== "cancelled" && new Date(b.starts_at).getTime() > Date.now(),
  );
  const past = rows.filter(
    (b) => b.status === "cancelled" || new Date(b.starts_at).getTime() <= Date.now(),
  );

  return (
    <section className="mx-auto max-w-4xl px-5 py-12">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">My bookings</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Private room</h1>
        </div>
        <Link
          to="/private-room"
          className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
        >
          Book another
        </Link>
      </div>

      {error && (
        <div className="mt-6 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="mt-6 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-500">
          {success}
        </div>
      )}

      {bookings.isLoading && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}

      {!bookings.isLoading && rows.length === 0 && (
        <div className="mt-10 rounded-lg border border-border/60 bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            You don't have any private room bookings yet.
          </p>
          <Link
            to="/private-room"
            className="mt-4 inline-block rounded-md bg-primary px-5 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
          >
            Book a session
          </Link>
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Upcoming
          </h2>
          <ul className="mt-4 space-y-4">
            {upcoming.map((b) => (
              <BookingCard
                key={b.id}
                booking={b}
                isRescheduling={reschedulingId === b.id}
                confirmCancel={confirmCancelId === b.id}
                onStartReschedule={() => {
                  setReschedulingId(b.id);
                  setConfirmCancelId(null);
                  setError(null);
                  setSuccess(null);
                }}
                onCloseReschedule={() => setReschedulingId(null)}
                onRequestCancel={() => {
                  setConfirmCancelId(b.id);
                  setReschedulingId(null);
                  setError(null);
                  setSuccess(null);
                }}
                onDismissCancel={() => setConfirmCancelId(null)}
                onConfirmCancel={() => cancelMutation.mutate(b.id)}
                cancelPending={cancelMutation.isPending}
                onReschedule={(startsAt) =>
                  rescheduleMutation.mutate({ id: b.id, startsAt })
                }
                reschedulePending={rescheduleMutation.isPending}
              />
            ))}
          </ul>
        </div>
      )}

      {past.length > 0 && (
        <div className="mt-10">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Past & cancelled
          </h2>
          <ul className="mt-4 space-y-3">
            {past.map((b) => (
              <li
                key={b.id}
                className="rounded-lg border border-border/60 bg-card/30 px-5 py-4 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-medium">
                      {format(new Date(b.starts_at), "EEE d MMM yyyy · HH:mm")}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {b.duration_minutes} min
                      {b.party_size ? ` · party of ${b.party_size}` : ""}
                    </div>
                  </div>
                  <StatusBadge status={b.status} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    confirmed: "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
    pending: "border-amber-500/40 bg-amber-500/10 text-amber-500",
    cancelled: "border-muted-foreground/40 bg-muted/30 text-muted-foreground",
  };
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-widest",
        map[status] ?? "border-border bg-muted/20 text-muted-foreground",
      )}
    >
      {status}
    </span>
  );
}

function BookingCard(props: {
  booking: Booking;
  isRescheduling: boolean;
  confirmCancel: boolean;
  onStartReschedule: () => void;
  onCloseReschedule: () => void;
  onRequestCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
  cancelPending: boolean;
  onReschedule: (startsAt: string) => void;
  reschedulePending: boolean;
}) {
  const b = props.booking;
  const starts = new Date(b.starts_at);
  const canCancel = starts.getTime() - Date.now() > 2 * 60 * 60 * 1000;
  const price = b.amount_cents
    ? `${(b.amount_cents / 100).toFixed(2)} ${b.currency.toUpperCase()}`
    : null;

  return (
    <li className="rounded-lg border border-border/60 bg-card/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="font-display text-lg font-semibold">
            {format(starts, "EEEE d MMMM yyyy")}
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            {format(starts, "HH:mm")} · {b.duration_minutes} min
            {b.party_size ? ` · party of ${b.party_size}` : ""}
            {price ? ` · ${price}` : ""}
          </div>
          {b.notes && (
            <div className="mt-2 text-xs text-muted-foreground">Notes: {b.notes}</div>
          )}
        </div>
        <StatusBadge status={b.status} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {!props.isRescheduling && !props.confirmCancel && (
          <>
            <button
              type="button"
              onClick={props.onStartReschedule}
              className="rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
            >
              Reschedule
            </button>
            <button
              type="button"
              onClick={props.onRequestCancel}
              disabled={!canCancel}
              className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-destructive hover:bg-destructive/20 disabled:opacity-40"
              title={canCancel ? "" : "Bookings must be cancelled at least 2 hours ahead"}
            >
              Cancel
            </button>
          </>
        )}
        {!canCancel && !props.isRescheduling && !props.confirmCancel && (
          <span className="self-center text-xs text-muted-foreground">
            Contact support to change bookings less than 2 hours away.
          </span>
        )}
      </div>

      {props.confirmCancel && (
        <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-4">
          <p className="text-sm">Cancel this booking? This cannot be undone.</p>
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={props.onConfirmCancel}
              disabled={props.cancelPending}
              className="rounded-md bg-destructive px-4 py-2 text-xs font-semibold uppercase tracking-widest text-destructive-foreground disabled:opacity-60"
            >
              {props.cancelPending ? "Cancelling…" : "Yes, cancel"}
            </button>
            <button
              type="button"
              onClick={props.onDismissCancel}
              className="rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest hover:bg-muted/30"
            >
              Keep booking
            </button>
          </div>
        </div>
      )}

      {props.isRescheduling && (
        <ReschedulePicker
          durationMinutes={b.duration_minutes}
          currentBookingId={b.id}
          pending={props.reschedulePending}
          onCancel={props.onCloseReschedule}
          onSubmit={props.onReschedule}
        />
      )}
    </li>
  );
}

function ReschedulePicker(props: {
  durationMinutes: number;
  currentBookingId: string;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (startsAt: string) => void;
}) {
  const [date, setDate] = useState<Date | undefined>(() =>
    startOfDay(addDays(new Date(), 1)),
  );
  const [slot, setSlot] = useState<Date | null>(null);

  const dayRange = useMemo(() => {
    if (!date) return null;
    const from = new Date(date);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [date]);

  const busyFn = useServerFn(listPrivateRoomBusy);
  const busyQuery = useQuery({
    queryKey: ["private-room-busy", dayRange?.from, dayRange?.to],
    enabled: !!dayRange,
    queryFn: () => busyFn({ data: dayRange! }),
    staleTime: 30_000,
  });

  const slots = useMemo(() => {
    if (!date) return [];
    const day = new Date(date);
    day.setHours(0, 0, 0, 0);
    const out: Date[] = [];
    for (let h = DAY_START_HOUR; h < DAY_END_HOUR; h++) {
      for (let m = 0; m < 60; m += SLOT_STEP_MIN) {
        const d = new Date(day);
        d.setHours(h, m, 0, 0);
        const end = new Date(d.getTime() + props.durationMinutes * 60_000);
        if (end.getHours() > DAY_END_HOUR || (end.getHours() === DAY_END_HOUR && end.getMinutes() > 0)) continue;
        out.push(d);
      }
    }
    return out;
  }, [date, props.durationMinutes]);

  const busy = busyQuery.data ?? [];
  const now = Date.now();
  const leadMs = 60 * 60 * 1000;

  return (
    <div className="mt-4 rounded-md border border-border/60 bg-background/40 p-4">
      <div className="grid gap-4 md:grid-cols-[auto_1fr]">
        <Calendar
          mode="single"
          selected={date}
          onSelect={(d) => {
            setDate(d);
            setSlot(null);
          }}
          disabled={(d) => d < startOfDay(new Date())}
          className="rounded-md border border-border/60"
        />
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Pick a new time ({props.durationMinutes} min)
          </div>
          <div className="mt-2 grid grid-cols-4 gap-2">
            {slots.map((s) => {
              const start = s.getTime();
              const end = start + props.durationMinutes * 60_000;
              const isPast = start - now < leadMs;
              const overlaps = busy.some((r) => {
                const bs = new Date(r.starts_at).getTime();
                const be = bs + r.duration_minutes * 60_000;
                return bs < end && be > start;
              });
              const disabled = isPast || overlaps;
              const selected = slot?.getTime() === start;
              return (
                <button
                  key={start}
                  type="button"
                  disabled={disabled}
                  onClick={() => setSlot(s)}
                  className={cn(
                    "rounded-md border px-2 py-2 text-xs",
                    disabled && "line-through opacity-40",
                    selected
                      ? "border-primary bg-primary/20 text-primary"
                      : "border-border/60 hover:bg-muted/30",
                  )}
                >
                  {format(s, "HH:mm")}
                </button>
              );
            })}
          </div>
          {slots.length === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">No slots that day.</p>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!slot || props.pending}
          onClick={() => slot && props.onSubmit(slot.toISOString())}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          {props.pending ? "Rescheduling…" : "Confirm new time"}
        </button>
        <button
          type="button"
          onClick={props.onCancel}
          className="rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest hover:bg-muted/30"
        >
          Close
        </button>
      </div>
    </div>
  );
}
