import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { format, addDays, startOfDay, isSameDay, isWithinInterval } from "date-fns";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  listMyPrivateRoomBookings,
  cancelMyPrivateRoomBooking,
  rescheduleMyPrivateRoomBooking,
  listPrivateRoomBusy,
  listMyPrivateRoomBookingHistory,
} from "@/lib/store.functions";
import { sendBookingConfirmationEmail } from "@/lib/booking-email.functions";
import { Calendar } from "@/components/ui/calendar";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

const bookingSearchSchema = z.object({
  status: fallback(z.enum(["all", "confirmed", "pending", "cancelled"]), "all").default("all"),
  date: fallback(z.enum(["all", "today", "week", "month"]), "all").default("all"),
  booking: fallback(z.string().uuid().optional(), undefined).optional(),
  action: fallback(z.enum(["reschedule", "cancel"]).optional(), undefined).optional(),
});

export const Route = createFileRoute("/_authenticated/bookings")({
  validateSearch: zodValidator(bookingSearchSchema),
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
  const { status, date: dateFilter, booking: bookingParam, action: actionParam } = Route.useSearch();
  const navigate = useNavigate({ from: "/bookings" });
  const listFn = useServerFn(listMyPrivateRoomBookings);
  const cancelFn = useServerFn(cancelMyPrivateRoomBooking);
  const rescheduleFn = useServerFn(rescheduleMyPrivateRoomBooking);
  const resendEmailFn = useServerFn(sendBookingConfirmationEmail);
  const qc = useQueryClient();
  const bookings = useQuery({
    queryKey: ["my-private-room-bookings"],
    queryFn: () => listFn(),
  });

  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [confirmCancelId, setConfirmCancelId] = useState<string | null>(null);
  const [detailsId, setDetailsId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resendingEmailId, setResendingEmailId] = useState<string | null>(null);

  // Deep-link support: /bookings?booking=<id>&action=reschedule|cancel
  // Opens the matching sheet once the booking list has loaded, then strips
  // the params so refreshes/back-navigation don't re-trigger the action.
  const allBookings = bookings.data ?? [];
  useEffect(() => {
    if (!bookingParam || !actionParam) return;
    const match = allBookings.find((b) => b.id === bookingParam);
    if (!match) return;
    if (actionParam === "reschedule") {
      setReschedulingId(bookingParam);
      setConfirmCancelId(null);
    } else if (actionParam === "cancel") {
      setConfirmCancelId(bookingParam);
      setReschedulingId(null);
    }
    setError(null);
    setSuccess(null);
    void navigate({
      search: (prev: Record<string, unknown>) => ({ ...prev, booking: undefined, action: undefined }),
      replace: true,
    });
  }, [bookingParam, actionParam, allBookings, navigate]);


  const cancelMutation = useMutation({
    mutationFn: (id: string) =>
      cancelFn({
        data: { id, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone },
      }),
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

  const resendEmailMutation = useMutation({
    mutationFn: (id: string) =>
      resendEmailFn({
        data: {
          bookingId: id,
          resend: true,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      }),
    onSuccess: (result) => {
      if (result.success) {
        setSuccess("Confirmation email resent.");
        setError(null);
      } else if (result.reason === "not_confirmed") {
        setError("Only confirmed bookings can receive a confirmation email.");
        setSuccess(null);
      } else if (result.reason === "no_recipient") {
        setError("No email address found for this booking.");
        setSuccess(null);
      } else {
        setError("Could not resend confirmation email. Please try again later.");
        setSuccess(null);
      }
      setResendingEmailId(null);
    },
    onError: (e: Error) => {
      setError(e.message);
      setSuccess(null);
      setResendingEmailId(null);
    },
  });

  const rows: Booking[] = (bookings.data ?? []) as Booking[];

  const filteredRows = useMemo(() => {
    const today = startOfDay(new Date());
    return rows.filter((b) => {
      if (status !== "all" && b.status !== status) return false;
      const starts = new Date(b.starts_at);
      if (dateFilter === "today") return isSameDay(starts, today);
      if (dateFilter === "week") {
        const end = addDays(today, 7);
        return isWithinInterval(starts, { start: today, end });
      }
      if (dateFilter === "month") {
        const end = addDays(today, 30);
        return isWithinInterval(starts, { start: today, end });
      }
      return true;
    });
  }, [rows, status, dateFilter]);

  const upcoming = filteredRows.filter(
    (b) => b.status !== "cancelled" && new Date(b.starts_at).getTime() > Date.now(),
  );
  const past = filteredRows.filter(
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

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Select
          value={status}
          onValueChange={(value) =>
            navigate({ search: { status: value as typeof status, date: dateFilter } })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={dateFilter}
          onValueChange={(value) =>
            navigate({ search: { status, date: value as typeof dateFilter } })
          }
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Date" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All dates</SelectItem>
            <SelectItem value="today">Today</SelectItem>
            <SelectItem value="week">Next 7 days</SelectItem>
            <SelectItem value="month">Next 30 days</SelectItem>
          </SelectContent>
        </Select>

        {(status !== "all" || dateFilter !== "all") && (
          <button
            type="button"
            onClick={() => navigate({ search: { status: "all", date: "all" } })}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Clear filters
          </button>
        )}
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

      {!bookings.isLoading && rows.length > 0 && filteredRows.length === 0 && (
        <div className="mt-10 rounded-lg border border-border/60 bg-card/40 p-8 text-center">
          <p className="text-sm text-muted-foreground">
            No bookings match the selected filters.
          </p>
          <button
            type="button"
            onClick={() => navigate({ search: { status: "all", date: "all" } })}
            className="mt-4 inline-block rounded-md bg-primary px-5 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
          >
            Clear filters
          </button>
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
                resendEmailPending={resendingEmailId === b.id && resendEmailMutation.isPending}
                onStartReschedule={() => {
                  setReschedulingId(b.id);
                  setConfirmCancelId(null);
                  setError(null);
                  setSuccess(null);
                  setResendingEmailId(null);
                }}
                onCloseReschedule={() => setReschedulingId(null)}
                onRequestCancel={() => {
                  setConfirmCancelId(b.id);
                  setReschedulingId(null);
                  setError(null);
                  setSuccess(null);
                  setResendingEmailId(null);
                }}
                onDismissCancel={() => setConfirmCancelId(null)}
                onConfirmCancel={() => cancelMutation.mutate(b.id)}
                cancelPending={cancelMutation.isPending}
                onReschedule={(startsAt) =>
                  rescheduleMutation.mutate({ id: b.id, startsAt })
                }
                reschedulePending={rescheduleMutation.isPending}
                onOpenDetails={() => setDetailsId(b.id)}
                onResendEmail={() => {
                  setResendingEmailId(b.id);
                  setError(null);
                  setSuccess(null);
                  resendEmailMutation.mutate(b.id);
                }}
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
                  <div className="flex items-center gap-2">
                    <StatusBadge status={b.status} />
                    <button
                      type="button"
                      onClick={() => setDetailsId(b.id)}
                      className="rounded-md border border-border/60 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted/30 hover:text-foreground"
                    >
                      View details
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <BookingDetailsDrawer
        booking={rows.find((r) => r.id === detailsId) ?? null}
        onClose={() => setDetailsId(null)}
      />
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
  resendEmailPending: boolean;
  onStartReschedule: () => void;
  onCloseReschedule: () => void;
  onRequestCancel: () => void;
  onDismissCancel: () => void;
  onConfirmCancel: () => void;
  cancelPending: boolean;
  onReschedule: (startsAt: string) => void;
  reschedulePending: boolean;
  onOpenDetails: () => void;
  onResendEmail: () => void;
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
            {b.status === "confirmed" && (
              <>
                <a
                  href={`/api/public/bookings/${b.id}/ics`}
                  download={`booking-${b.id.slice(0, 8)}.ics`}
                  className="rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/15"
                >
                  Add to calendar
                </a>
                <button
                  type="button"
                  onClick={props.onResendEmail}
                  disabled={props.resendEmailPending}
                  className="rounded-md border border-primary/40 bg-primary/5 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/15 disabled:opacity-60"
                >
                  {props.resendEmailPending ? "Resending…" : "Resend confirmation email"}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={props.onOpenDetails}
              className="rounded-md border border-border/60 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted/30 hover:text-foreground"
            >
              View details
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
          currentStartsAt={b.starts_at}
          amountCents={b.amount_cents}
          currency={b.currency}
          partySize={b.party_size}
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
  currentStartsAt: string;
  amountCents: number | null;
  currency: string;
  partySize: number | null;
  pending: boolean;
  onCancel: () => void;
  onSubmit: (startsAt: string) => void;
}) {
  const [date, setDate] = useState<Date | undefined>(() =>
    startOfDay(addDays(new Date(), 1)),
  );
  const [slot, setSlot] = useState<Date | null>(null);
  const [reviewing, setReviewing] = useState(false);

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

  const currencyUpper = (props.currency ?? "aud").toUpperCase();
  const fmtMoney = (cents: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: currencyUpper }).format(
      cents / 100,
    );
  const currentStart = new Date(props.currentStartsAt);

  if (reviewing && slot) {
    return (
      <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-4">
        <div className="text-xs uppercase tracking-widest text-primary">
          Confirm reschedule
        </div>
        <dl className="mt-3 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Current time</dt>
            <dd className="text-right line-through opacity-70">
              {format(currentStart, "EEE d MMM · HH:mm")}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">New time</dt>
            <dd className="text-right font-semibold">
              {format(slot, "EEE d MMM yyyy · HH:mm")}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">Duration</dt>
            <dd className="text-right">{props.durationMinutes} min</dd>
          </div>
          {props.partySize != null && (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">Party size</dt>
              <dd className="text-right">{props.partySize}</dd>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2 font-semibold">
            <dt>Total</dt>
            <dd className="text-right">
              {props.amountCents != null ? fmtMoney(props.amountCents) : "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          {props.amountCents != null
            ? "No additional charge — your original payment moves to the new time."
            : "You may be redirected to checkout to confirm your new time."}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={props.pending}
            onClick={() => props.onSubmit(slot.toISOString())}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
          >
            {props.pending ? "Rescheduling…" : "Confirm & reschedule"}
          </button>
          <button
            type="button"
            disabled={props.pending}
            onClick={() => setReviewing(false)}
            className="rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest hover:bg-muted/30"
          >
            ← Back to pick a time
          </button>
        </div>
      </div>
    );
  }

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
          onClick={() => slot && setReviewing(true)}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          Review new time
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

function BookingDetailsDrawer({
  booking,
  onClose,
}: {
  booking: Booking | null;
  onClose: () => void;
}) {
  const open = booking !== null;
  const b = booking;

  // Base rates for the private room (kept in sync with private-room.tsx).
  const RATE_AUD_CENTS = { 30: 15000, 60: 27500 } as const;
  const durationKey =
    b && (b.duration_minutes === 30 || b.duration_minutes === 60)
      ? (b.duration_minutes as 30 | 60)
      : null;
  const currency = (b?.currency ?? "aud").toUpperCase();
  const fmtMoney = (cents: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);

  const baseCents = durationKey ? RATE_AUD_CENTS[durationKey] : null;
  const totalCents = b?.amount_cents ?? null;
  // If Stripe billed more than the base (e.g. GST-inclusive processing),
  // surface the delta as a "Taxes & fees" line so the totals reconcile.
  const feeCents =
    baseCents != null && totalCents != null && totalCents > baseCents
      ? totalCents - baseCents
      : null;

  return (
    <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        {b && (
          <>
            <SheetHeader className="text-left">
              <SheetTitle className="font-display text-2xl">
                Booking details
              </SheetTitle>
              <SheetDescription>
                {format(new Date(b.starts_at), "EEEE d MMMM yyyy · HH:mm")}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-6 text-sm">
              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Status
                </div>
                <div className="mt-2">
                  <StatusBadge status={b.status} />
                </div>
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Session
                </div>
                <dl className="mt-2 space-y-1.5">
                  <DetailRow label="Duration">{b.duration_minutes} min</DetailRow>
                  <DetailRow label="Party size">
                    {b.party_size ?? 1}{" "}
                    {(b.party_size ?? 1) === 1 ? "guest" : "guests"}
                  </DetailRow>
                  <DetailRow label="Booked by">
                    {b.customer_email ?? "—"}
                  </DetailRow>
                  <DetailRow label="Booking ID">
                    <span className="font-mono text-[11px]">
                      {b.id.slice(0, 8)}
                    </span>
                  </DetailRow>
                  <DetailRow label="Created">
                    {format(new Date(b.created_at), "d MMM yyyy · HH:mm")}
                  </DetailRow>
                </dl>
              </div>

              <BookingStatusTimeline bookingId={b.id} />

              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Notes
                </div>
                {b.notes ? (
                  <div className="mt-2 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 px-3 py-2">
                    {b.notes}
                  </div>
                ) : (
                  <div className="mt-2 text-muted-foreground">No notes provided.</div>
                )}
              </div>

              <div>
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Pricing
                </div>
                <dl className="mt-2 space-y-1.5">
                  {baseCents != null && (
                    <DetailRow
                      label={`${b.duration_minutes}-min session`}
                    >
                      {fmtMoney(baseCents)}
                    </DetailRow>
                  )}
                  {feeCents != null && feeCents > 0 && (
                    <DetailRow label="Taxes & fees">
                      {fmtMoney(feeCents)}
                    </DetailRow>
                  )}
                  <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 font-semibold">
                    <span>{b.status === "cancelled" ? "Amount (cancelled)" : "Total paid"}</span>
                    <span>
                      {totalCents != null
                        ? fmtMoney(totalCents)
                        : baseCents != null
                          ? fmtMoney(baseCents)
                          : "—"}
                    </span>
                  </div>
                </dl>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{children}</dd>
    </div>
  );
}

const STATUS_TIMELINE_LABEL: Record<string, string> = {
  pending: "Held",
  confirmed: "Confirmed",
  cancelled: "Cancelled",
};

const STATUS_TIMELINE_DOT: Record<string, string> = {
  pending: "bg-amber-500",
  confirmed: "bg-emerald-500",
  cancelled: "bg-muted-foreground",
};

function BookingStatusTimeline({ bookingId }: { bookingId: string }) {
  const historyFn = useServerFn(listMyPrivateRoomBookingHistory);
  const q = useQuery({
    queryKey: ["private-room-booking-history", bookingId],
    queryFn: () => historyFn({ data: { id: bookingId } }),
    staleTime: 30_000,
  });
  const events = q.data ?? [];
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
        Status timeline
      </div>
      {q.isLoading ? (
        <div className="mt-2 text-xs text-muted-foreground">Loading history…</div>
      ) : events.length === 0 ? (
        <div className="mt-2 text-xs text-muted-foreground">No status changes yet.</div>
      ) : (
        <ol className="mt-3 space-y-3">
          {events.map((e, i) => {
            const isLast = i === events.length - 1;
            return (
              <li key={e.id} className="relative flex gap-3">
                <div className="flex flex-col items-center">
                  <span
                    className={cn(
                      "mt-1 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                      STATUS_TIMELINE_DOT[e.status] ?? "bg-muted-foreground",
                    )}
                  />
                  {!isLast && (
                    <span className="mt-1 w-px flex-1 bg-border/60" aria-hidden />
                  )}
                </div>
                <div className="pb-1">
                  <div className="text-sm font-medium">
                    {STATUS_TIMELINE_LABEL[e.status] ?? e.status}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(e.changed_at), "d MMM yyyy · HH:mm")}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}


