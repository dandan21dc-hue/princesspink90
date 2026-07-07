import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { listPrivateRoomBusy } from "@/lib/store.functions";

export const Route = createFileRoute("/private-room")({
  head: () => ({
    meta: [
      { title: "Private Room Booking — Princess Pink" },
      {
        name: "description",
        content:
          "Book a private-room session with Princess Pink — 30 minutes or 1 hour. Pick a date and time, pay securely.",
      },
      { property: "og:title", content: "Private Room Booking · Princess Pink" },
      {
        property: "og:description",
        content: "Reserve a 30-minute or 1-hour private session.",
      },
    ],
  }),
  component: PrivateRoomPage,
});

const DAY_START_HOUR = 10; // 10:00
const DAY_END_HOUR = 22; // last slot must end by 22:00
const SLOT_STEP_MIN = 30;

type Duration = 30 | 60;

function PrivateRoomPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(() =>
    startOfDay(addDays(new Date(), 1)),
  );
  const [duration, setDuration] = useState<Duration>(60);
  const [selectedSlot, setSelectedSlot] = useState<Date | null>(null);
  const [partySize, setPartySize] = useState<number>(1);
  const [notes, setNotes] = useState<string>("");
  const { openCheckout, checkoutElement, isOpen, closeCheckout } = useStripeCheckout();
  const [pending, setPending] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [finding, setFinding] = useState(false);
  const [jumpingToSlot, setJumpingToSlot] = useState<Date | null>(null);


  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email ?? undefined });
    });
  }, []);

  // Reset the picked slot when the day or duration changes, unless we're
  // jumping to a found "next available" slot.
  useEffect(() => {
    if (
      jumpingToSlot &&
      selectedDate &&
      startOfDay(jumpingToSlot).getTime() === selectedDate.getTime()
    ) {
      setSelectedSlot(new Date(jumpingToSlot.getTime()));
      const el = document.getElementById(`slot-${jumpingToSlot.getTime()}`);
      el?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setJumpingToSlot(null);
      return;
    }

    setSelectedSlot(null);
  }, [selectedDate, duration, jumpingToSlot]);


  const dayRange = useMemo(() => {
    if (!selectedDate) return null;
    const from = new Date(selectedDate);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setDate(to.getDate() + 1);
    return { from: from.toISOString(), to: to.toISOString() };
  }, [selectedDate]);

  const busyQuery = useQuery({
    queryKey: ["private-room-busy", dayRange?.from, dayRange?.to],
    enabled: !!dayRange,
    queryFn: () => listPrivateRoomBusy({ data: dayRange! }),
    staleTime: 30_000,
  });

  const slots = useMemo(() => {
    if (!selectedDate) return [];
    const day = new Date(selectedDate);
    const out: Date[] = [];
    for (let h = DAY_START_HOUR * 60; h + duration <= DAY_END_HOUR * 60; h += SLOT_STEP_MIN) {
      const d = new Date(day);
      d.setHours(0, 0, 0, 0);
      d.setMinutes(h);
      out.push(d);
    }
    return out;
  }, [selectedDate, duration]);

  const busyRanges = useMemo(() => {
    return (busyQuery.data ?? []).map((b) => {
      const start = new Date(b.starts_at).getTime();
      const end = start + b.duration_minutes * 60_000;
      return { start, end };
    });
  }, [busyQuery.data]);

  const now = Date.now();

  async function jumpToNextAvailable() {
    setFinding(true);
    try {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + 30 * 24 * 60 * 60 * 1000);
      const busy = await listPrivateRoomBusy({
        data: { from: from.toISOString(), to: to.toISOString() },
      });
      const ranges = busy.map((b) => {
        const start = new Date(b.starts_at).getTime();
        const end = start + b.duration_minutes * 60_000;
        return { start, end };
      });
      const earliest = Date.now() + 60 * 60 * 1000;
      let found: Date | null = null;
      for (let d = 0; d < 30 && !found; d++) {
        const day = startOfDay(addDays(new Date(), d));
        for (
          let m = DAY_START_HOUR * 60;
          m + duration <= DAY_END_HOUR * 60;
          m += SLOT_STEP_MIN
        ) {
          const slot = new Date(day);
          slot.setHours(0, 0, 0, 0);
          slot.setMinutes(m);
          const s = slot.getTime();
          if (s < earliest) continue;
          const e = s + duration * 60_000;
          if (!ranges.some((b) => b.start < e && b.end > s)) {
            found = slot;
            break;
          }
        }
      }
      if (found) {
        setSelectedDate(startOfDay(found));
        setJumpingToSlot(found);
      } else {
        window.alert("No available slots in the next 30 days.");
      }

    } finally {
      setFinding(false);
    }
  }

  function slotConflicts(start: Date) {

    const s = start.getTime();
    const e = s + duration * 60_000;
    if (s < now + 60 * 60 * 1000) return true; // 1h lead time
    return busyRanges.some((b) => b.start < e && b.end > s);
  }

  function review() {
    if (!user) {
      navigate({ to: "/auth", search: { next: "/private-room" } });
      return;
    }
    if (!selectedSlot) return;
    if (partySize < 1 || partySize > 10) return;
    if (notes.length > 1000) return;
    setReviewing(true);
  }

  function confirm() {
    if (pending) return;
    if (!user || !selectedSlot) return;
    setPending(true);
    const priceId = duration === 30 ? "private_room_30min_aud" : "private_room_60min_aud";
    openCheckout({
      priceId,
      userId: user.id,
      customerEmail: user.email,
      bookingStartsAt: selectedSlot.toISOString(),
      bookingPartySize: partySize,
      bookingNotes: notes.trim() || undefined,
      returnUrl: `${window.location.origin}/checkout/return?next=%2Fdashboard`,
    });
  }


  useEffect(() => {
    // Re-enable the confirm button if the user dismisses the embedded
    // checkout without paying — otherwise it would stay stuck as
    // "Processing…" until a full reload.
    if (!isOpen && pending) setPending(false);
  }, [isOpen, pending]);

  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-5xl px-5 pt-10 pb-16">
        <Link
          to="/store"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Store
        </Link>

        {isOpen ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-display text-lg">Checkout</div>
              <button
                onClick={closeCheckout}
                className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
            </div>
            {checkoutElement}
          </div>
        ) : reviewing && selectedSlot ? (
          <ReviewBookingCard
            selectedSlot={selectedSlot}
            duration={duration}
            partySize={partySize}
            notes={notes}
            pending={pending}
            onEdit={() => setReviewing(false)}
            onConfirm={confirm}
          />
        ) : (
          <>
            <div className="mt-4">
              <div className="text-xs uppercase tracking-[0.3em] text-primary">
                Private Room
              </div>
              <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
                Book a private session
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Pick your length, your day, and your time. Slot is held while you
                complete checkout.
              </p>
            </div>

            {/* Duration toggle */}
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <DurationCard
                selected={duration === 30}
                onClick={() => setDuration(30)}
                label="30 minutes"
                price="A$150"
              />
              <DurationCard
                selected={duration === 60}
                onClick={() => setDuration(60)}
                label="1 hour"
                price="A$275"
              />
            </div>

            <div className="mt-8 grid gap-8 md:grid-cols-[auto_1fr]">
              <div className="rounded-2xl border border-border/60 bg-card p-2">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={setSelectedDate}
                  disabled={(date) => date < startOfDay(new Date())}
                  className={cn("p-3 pointer-events-auto")}
                  initialFocus
                />
              </div>

              <div>
                <div className="mb-3 flex items-center justify-between">
                  <div className="font-display text-lg">
                    {selectedDate ? format(selectedDate, "EEEE, d MMMM") : "Pick a date"}
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      type="button"
                      onClick={jumpToNextAvailable}
                      disabled={finding}
                      className="text-xs uppercase tracking-widest text-primary hover:text-primary/80 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {finding ? "Finding…" : "Next available"}
                    </button>
                    <div className="text-xs text-muted-foreground">
                      {busyQuery.isFetching ? "Checking availability…" : `${slots.filter((s) => !slotConflicts(s)).length} slots free`}
                    </div>
                  </div>
                </div>


                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((s) => {
                    const disabled = slotConflicts(s);
                    const active = selectedSlot?.getTime() === s.getTime();
                    return (
                      <button
                        id={`slot-${s.getTime()}`}
                        key={s.toISOString()}
                        onClick={() => !disabled && setSelectedSlot(s)}
                        disabled={disabled}

                        className={cn(
                          "rounded-md border px-3 py-2 text-sm font-medium transition",
                          disabled
                            ? "cursor-not-allowed border-border/40 bg-muted/30 text-muted-foreground/50 line-through"
                            : active
                              ? "border-primary bg-primary text-primary-foreground shadow-[var(--shadow-glow-pink)]"
                              : "border-border/60 bg-background hover:border-primary/60 hover:text-primary",
                        )}
                      >
                        {format(s, "h:mm a")}
                      </button>
                    );
                  })}
                </div>

                <div
                  role="list"
                  aria-label="Slot availability legend"
                  className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground"
                >
                  <div role="listitem" className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-4 rounded-sm border border-border/60 bg-background"
                    />
                    <span>Available — tap to select</span>
                  </div>
                  <div role="listitem" className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-4 rounded-sm border border-dashed border-primary/40 bg-primary/10"
                    />
                    <span>Held — reserved during someone's checkout</span>
                  </div>
                  <div role="listitem" className="flex items-center gap-2">
                    <span
                      aria-hidden
                      className="inline-block h-3 w-4 rounded-sm border border-border/40 bg-muted/40"
                    />
                    <span className="line-through decoration-muted-foreground/60">Booked</span>
                  </div>
                </div>


                <div className="mt-8 grid gap-5 sm:grid-cols-2">
                  <div>
                    <label htmlFor="party-size" className="text-xs uppercase tracking-widest text-muted-foreground">
                      Party size
                    </label>
                    <select
                      id="party-size"
                      value={partySize}
                      onChange={(e) => setPartySize(Number(e.target.value))}
                      className="mt-2 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                    >
                      {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                        <option key={n} value={n}>
                          {n} {n === 1 ? "guest" : "guests"}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="duration-summary" className="text-xs uppercase tracking-widest text-muted-foreground">
                      Duration
                    </label>
                    <div
                      id="duration-summary"
                      className="mt-2 rounded-md border border-input bg-muted/20 px-3 py-2 text-sm"
                    >
                      {duration === 30 ? "30 minutes · A$150" : "1 hour · A$275"}
                    </div>
                  </div>
                </div>

                <div className="mt-5">
                  <label htmlFor="booking-notes" className="text-xs uppercase tracking-widest text-muted-foreground">
                    Notes for Princess (optional)
                  </label>
                  <textarea
                    id="booking-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value.slice(0, 1000))}
                    rows={4}
                    maxLength={1000}
                    placeholder="Requests, preferences, occasion, anything I should know…"
                    className="mt-2 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                  />
                  <div className="mt-1 text-right text-[11px] text-muted-foreground">
                    {notes.length}/1000
                  </div>
                </div>


                <div className="mt-8 flex flex-wrap items-center gap-4">
                  <div className="text-sm">
                    {selectedSlot ? (
                      <>
                        <span className="text-muted-foreground">Selected: </span>
                        <span className="font-medium">
                          {format(selectedSlot, "EEE d MMM · h:mm a")} ·{" "}
                          {duration === 30 ? "30 min" : "1 hour"}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">Pick a time slot above.</span>
                    )}
                  </div>
                  <button
                    onClick={review}
                    disabled={!!user && !selectedSlot}
                    className="min-h-11 rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {!user ? "Sign in to book" : "Review booking"}
                  </button>
                </div>

                {!user && (
                  <div
                    role="status"
                    className="mt-3 rounded-md border border-primary/40 bg-primary/10 px-3 py-2 text-xs text-primary"
                  >
                    You need an account to submit a private room booking.{" "}
                    <Link
                      to="/auth"
                      search={{ next: "/private-room" }}
                      className="font-semibold underline underline-offset-2"
                    >
                      Sign in or create one
                    </Link>{" "}
                    to continue.
                  </div>
                )}

                <p className="mt-4 text-[11px] text-muted-foreground">
                  18+ only. Bookings must be at least 1 hour in advance. Slots
                  greyed out are already taken or on hold.
                </p>
              </div>
            </div>
          </>
        )}
      </section>
    </>
  );
}

function DurationCard({
  selected,
  onClick,
  label,
  price,
}: {
  selected: boolean;
  onClick: () => void;
  label: string;
  price: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-between rounded-2xl border p-5 text-left transition",
        selected
          ? "border-primary bg-primary/10 shadow-[var(--shadow-glow-pink)]"
          : "border-border/60 bg-card hover:border-primary/50",
      )}
    >
      <div>
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
          Private Room
        </div>
        <div className="mt-1 font-display text-2xl font-extrabold">{label}</div>
      </div>
      <div className="font-display text-2xl font-extrabold">{price}</div>
    </button>
  );
}

function ReviewBookingCard({
  selectedSlot,
  duration,
  partySize,
  notes,
  pending,
  onEdit,
  onConfirm,
}: {
  selectedSlot: Date;
  duration: Duration;
  partySize: number;
  notes: string;
  pending: boolean;
  onEdit: () => void;
  onConfirm: () => void;
}) {
  const priceLabel = duration === 30 ? "A$150" : "A$275";
  const endsAt = new Date(selectedSlot.getTime() + duration * 60_000);
  return (
    <div className="mx-auto mt-8 max-w-xl rounded-2xl border border-primary/40 bg-card p-6 shadow-[var(--shadow-glow-pink)]">
      <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
        Review your booking
      </div>
      <h2 className="mt-2 font-display text-2xl font-extrabold">
        Confirm the details below
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        You'll be taken to secure checkout after you confirm. Your slot is held
        for 15 minutes.
      </p>

      <dl className="mt-6 space-y-3 text-sm">
        <Row label="Date">{format(selectedSlot, "EEEE, d MMMM yyyy")}</Row>
        <Row label="Time">
          {format(selectedSlot, "h:mm a")} – {format(endsAt, "h:mm a")}
        </Row>
        <Row label="Duration">{duration === 30 ? "30 minutes" : "1 hour"}</Row>
        <Row label="Party size">
          {partySize} {partySize === 1 ? "guest" : "guests"}
        </Row>
        <Row label="Price">{priceLabel}</Row>
        {notes.trim() && (
          <div>
            <dt className="text-muted-foreground">Notes</dt>
            <dd className="mt-1 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm">
              {notes.trim()}
            </dd>
          </div>
        )}
      </dl>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <button
          onClick={onConfirm}
          disabled={pending}
          className="min-h-11 flex-1 rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Opening checkout…" : `Confirm & pay · ${priceLabel}`}
        </button>
        <button
          type="button"
          onClick={onEdit}
          disabled={pending}
          className="min-h-11 rounded-md border border-border/60 bg-background px-4 py-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground disabled:opacity-40"
        >
          Edit
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{children}</dd>
    </div>
  );
}

