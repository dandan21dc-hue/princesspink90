import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, startOfDay } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { listPrivateRoomBusy } from "@/lib/store.functions";

export const Route = createFileRoute("/store/private-room")({
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
  const { openCheckout, checkoutElement, isOpen, closeCheckout } = useStripeCheckout();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email ?? undefined });
    });
  }, []);

  // Reset the picked slot when the day or duration changes.
  useEffect(() => {
    setSelectedSlot(null);
  }, [selectedDate, duration]);

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

  function slotConflicts(start: Date) {
    const s = start.getTime();
    const e = s + duration * 60_000;
    if (s < now + 60 * 60 * 1000) return true; // 1h lead time
    return busyRanges.some((b) => b.start < e && b.end > s);
  }

  function confirm() {
    if (!selectedSlot) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    const priceId = duration === 30 ? "private_room_30min_aud" : "private_room_60min_aud";
    openCheckout({
      priceId,
      userId: user.id,
      customerEmail: user.email,
      bookingStartsAt: selectedSlot.toISOString(),
      returnUrl: `${window.location.origin}/checkout/return?next=%2Fdashboard`,
    });
  }

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
                  <div className="text-xs text-muted-foreground">
                    {busyQuery.isFetching ? "Checking availability…" : `${slots.filter((s) => !slotConflicts(s)).length} slots free`}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                  {slots.map((s) => {
                    const disabled = slotConflicts(s);
                    const active = selectedSlot?.getTime() === s.getTime();
                    return (
                      <button
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
                    onClick={confirm}
                    disabled={!selectedSlot}
                    className="rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Book · A${duration === 30 ? "150" : "275"}
                  </button>
                </div>

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
