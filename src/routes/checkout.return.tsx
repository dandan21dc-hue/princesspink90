import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  getCheckoutSession,
  getMyPrivateRoomBookingBySession,
} from "@/lib/store.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { cart as cartStore } from "@/lib/cart";
import { track } from "@/lib/track";
import {
  buildPantyReturnEvent,
  buildPantyReturnErrorEvents,
} from "@/lib/pantyCheckoutEvents";
import { useMyTiers, type PlanId } from "@/hooks/useMyTiers";
import { format } from "date-fns";
import { buildIcs, downloadIcs } from "@/lib/ics";


/**
 * Landing page for Stripe's `return_url`. Stripe substitutes
 * `{CHECKOUT_SESSION_ID}` in the URL server-side before redirecting the
 * browser here, so `session_id` should always be a real `cs_...` id — not
 * the literal template string.
 *
 * The route:
 *  1. Validates `session_id` (and optional `next` destination) in search.
 *  2. Fetches the session server-side via `getCheckoutSession` to confirm
 *     status/metadata before granting UI access.
 *  3. Routes the user to the appropriate destination based on what they
 *     bought (membership → /library, booking → /dashboard, or the caller's
 *     explicit `next=` override).
 */

const ALLOWED_NEXT: readonly string[] = [
  "/library",
  "/dashboard",
  "/store",
];

function normalizeNext(next: string | undefined, metadata: { booking?: string | null } | null) {
  if (next && ALLOWED_NEXT.includes(next)) return next;
  if (metadata?.booking === "private_room") return "/dashboard";
  return "/library";
}

export const Route = createFileRoute("/checkout/return")({
  validateSearch: (search: Record<string, unknown>) => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: CheckoutReturn,
  head: () => ({
    meta: [
      { title: "Finalizing your purchase" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function CheckoutReturn() {
  const { session_id: sessionId, next } = Route.useSearch();
  const navigate = useNavigate();

  // Guard: `{CHECKOUT_SESSION_ID}` means Stripe never substituted the
  // template — the return_url shipped with the braces percent-encoded, or
  // was overridden somewhere. Treat as an error rather than calling the
  // API with a garbage id.
  const templateNotSubstituted =
    !sessionId || sessionId === "{CHECKOUT_SESSION_ID}" || sessionId.includes("%7B");

  const query = useQuery({
    queryKey: ["checkout-session", sessionId],
    enabled: !templateNotSubstituted,
    retry: 2,
    queryFn: async () => {
      const result = await getCheckoutSession({
        data: { sessionId: sessionId!, environment: getStripeEnvironment() },
      });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
  });

  const session = query.data;
  const isComplete = session?.status === "complete";
  const destination = normalizeNext(next, session?.metadata ?? null);

  // Fire tracking events for panty checkouts as the return-page state resolves.
  // De-duplicated so re-renders (and the redirect delay) don't double-fire.
  const trackedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !session) return;
    const event = buildPantyReturnEvent(session, sessionId);
    if (!event) return;
    const key = `${sessionId}:${event.name}`;
    if (trackedRef.current === key) return;
    trackedRef.current = key;
    track(event.name, event.payload);
  }, [sessionId, session]);

  // Track return-page load failures (session retrieve errored, or Stripe
  // shipped a placeholder session_id back). Separate ref so it can't clash
  // with the panty status event above.
  const errorTrackedRef = useRef<string | null>(null);
  useEffect(() => {
    if (templateNotSubstituted) {
      if (errorTrackedRef.current === "template") return;
      errorTrackedRef.current = "template";
      for (const e of buildPantyReturnErrorEvents({
        templateNotSubstituted: true,
        sessionId,
      })) {
        track(e.name, e.payload);
      }
      return;
    }
    if (!query.isError || !sessionId) return;
    const key = `error:${sessionId}`;
    if (errorTrackedRef.current === key) return;
    errorTrackedRef.current = key;
    for (const e of buildPantyReturnErrorEvents({
      templateNotSubstituted: false,
      sessionId,
      errorMessage: (query.error as Error)?.message,
    })) {
      track(e.name, e.payload);
    }
  }, [templateNotSubstituted, query.isError, query.error, sessionId]);

  // Attribution: fire once per completed checkout with the tier the user
  // originally clicked, so subscription / lifetime / term-pass purchases can
  // be traced back to the boutique card that drove them. Deduplicated by
  // sessionId so re-renders and the redirect delay don't double-count.
  const attributionRef = useRef<string | null>(null);
  useEffect(() => {
    if (!sessionId || !session || !isComplete) return;
    if (attributionRef.current === sessionId) return;
    const md = session.metadata ?? {};
    // Derive the PlanId / tier the user bought from the checkout metadata.
    // - subscription: metadata.subscription is the price lookup_key (== PlanId).
    // - lifetime: fixed PlanId "lifetime_onetime_aud".
    // - term_pass: map term_months back to the corresponding PlanId.
    // - panty / cart / booking / other: report the raw kind so downstream
    //   analytics can still attribute the conversion, without inventing a
    //   plan_id we don't have.
    let planId: PlanId | null = null;
    let tierKind:
      | "subscription"
      | "lifetime"
      | "term_pass"
      | "panty"
      | "cart"
      | "private_room"
      | "other" = "other";
    if (md.subscription) {
      planId = md.subscription as PlanId;
      tierKind = "subscription";
    } else if (md.membership === "lifetime") {
      planId = "lifetime_onetime_aud";
      tierKind = "lifetime";
    } else if (md.membership === "term_pass") {
      tierKind = "term_pass";
      const months = md.term_months ? Number(md.term_months) : null;
      planId =
        months === 3
          ? "all_access_3mo_monthly_aud"
          : months === 6
            ? "all_access_6mo_monthly_aud"
            : months === 12
              ? "all_access_12mo_monthly_aud"
              : null;
    } else if (md.panty_order) {
      tierKind = "panty";
    } else if (md.cart_mode === "1") {
      tierKind = "cart";
    } else if (md.booking === "private_room") {
      tierKind = "private_room";
    }
    attributionRef.current = sessionId;
    track("checkout_completed", {
      session_id: sessionId,
      tier_kind: tierKind,
      plan_id: planId ?? undefined,
      price_id: (md.subscription as string | undefined) ?? (md.panty_order as string | undefined) ?? undefined,
      term_months: md.term_months ? Number(md.term_months) : undefined,
      amount_total_cents: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      payment_intent_id: session.payment_intent_id ?? undefined,
      cart_mode: md.cart_mode === "1",
      booking: md.booking ?? undefined,
    });
  }, [sessionId, session, isComplete]);


  // Auto-redirect only for panty/cart checkouts — subscription and lifetime
  // buyers see a confirmation summary with dates and click through manually.
  const isMembershipPurchase =
    session?.metadata?.membership === "lifetime" ||
    session?.metadata?.membership === "term_pass" ||
    !!session?.metadata?.subscription;
  const isPrivateRoomPurchase = session?.metadata?.booking === "private_room";
  useEffect(() => {
    if (!isComplete || isMembershipPurchase || isPrivateRoomPurchase) return;
    // Cart mode: successful payment → wipe the local cart so the shopping bag
    // in the header resets and the user isn't offered a re-purchase.
    if (session?.metadata?.cart_mode === "1") {
      cartStore.clear();
      try {
        sessionStorage.removeItem("pp_cart_client_order_ref");
      } catch {
        // ignore
      }
    }
    const t = setTimeout(() => {
      navigate({ to: destination });
    }, 1500);
    return () => clearTimeout(t);
  }, [isComplete, destination, navigate, session?.metadata?.cart_mode, isMembershipPurchase, isPrivateRoomPurchase]);

  return (
    <section className="mx-auto max-w-md px-5 py-24 text-center">
      {templateNotSubstituted ? (
        <>
          <h1 className="text-2xl font-medium">Missing session</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            We couldn't identify your Stripe checkout session. If you completed
            payment, it will still be processed — please check your library in a
            minute.
          </p>
          <Link to="/library" className="mt-6 inline-block underline">
            Go to your library
          </Link>
        </>
      ) : query.isLoading ? (
        <>
          <h1 className="text-2xl font-medium">Finalizing…</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Confirming your payment with Stripe.
          </p>
        </>
      ) : query.isError ? (
        <>
          <h1 className="text-2xl font-medium">Something went wrong</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {(query.error as Error).message}
          </p>
          <Link to="/library" className="mt-6 inline-block underline">
            Go to your library
          </Link>
        </>
      ) : isComplete && isMembershipPurchase ? (
        <MembershipConfirmation
          metadata={session!.metadata ?? {}}
          destination={destination}
        />
      ) : isComplete && isPrivateRoomPurchase ? (
        <PrivateRoomConfirmation sessionId={sessionId!} />
      ) : isComplete ? (
        <>
          <h1 className="text-2xl font-medium">Thank you! 🎉</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Payment confirmed. Redirecting you now…
          </p>
          <Link to={destination as "/library"} className="mt-6 inline-block underline">
            Continue
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-medium">Payment pending</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Stripe is still processing this payment (status:{" "}
            {session?.status ?? "unknown"}). You'll get access as soon as it
            completes.
          </p>
          <Link to="/library" className="mt-6 inline-block underline">
            Go to your library
          </Link>
        </>
      )}
    </section>
  );
}

/**
 * Post-checkout summary for subscription and lifetime purchases: tells the
 * user which tier they bought, when access begins, and when the next
 * renewal / expiration date is. Reads live state from useMyTiers so the
 * dates come from what the webhook actually wrote — if the webhook hasn't
 * landed yet, shows a "finalising access" state that resolves via realtime.
 */
function MembershipConfirmation({
  metadata,
  destination,
}: {
  metadata: Record<string, string>;
  destination: string;
}) {
  const tiers = useMyTiers();

  const isLifetime = metadata.membership === "lifetime";
  const termMonths = metadata.term_months ? Number(metadata.term_months) : null;

  // Determine which plan row to read from useMyTiers.
  const planId: PlanId | null = isLifetime
    ? "lifetime_onetime_aud"
    : tiers.active.all_access_12mo_monthly_aud
      ? "all_access_12mo_monthly_aud"
      : tiers.active.all_access_6mo_monthly_aud
        ? "all_access_6mo_monthly_aud"
        : tiers.active.all_access_3mo_monthly_aud
          ? "all_access_3mo_monthly_aud"
          : tiers.active.all_access_monthly_aud
            ? "all_access_monthly_aud"
            : null;

  const planLabel = isLifetime
    ? "Lifetime Membership"
    : planId === "all_access_12mo_monthly_aud"
      ? "12-Month Plan"
      : planId === "all_access_6mo_monthly_aud"
        ? "6-Month Plan"
        : planId === "all_access_3mo_monthly_aud"
          ? "3-Month Plan"
          : planId === "all_access_monthly_aud"
            ? "Monthly Plan"
            : termMonths
              ? `${termMonths}-Month Pass`
              : "All-Access Pass";

  const fmt = (iso?: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch {
      return null;
    }
  };

  const start = planId ? fmt(tiers.starts[planId]) : null;
  const expires = planId && !isLifetime ? fmt(tiers.expires[planId]) : null;

  // Access hasn't hit the tables yet — show a friendly waiting state and
  // let realtime bring the row in.
  const stillWaiting =
    (isLifetime && !tiers.active.lifetime_onetime_aud && !tiers.loading) ||
    (!isLifetime && !planId && !tiers.loading);

  // Poll as a safety net for the ~30s after payment: realtime should deliver
  // the update the instant the webhook lands, but if it's slow or the
  // websocket dropped, keep asking every 2s until the tier appears.
  useEffect(() => {
    if (!stillWaiting) return;
    const id = window.setInterval(() => tiers.refresh(), 2000);
    const stop = window.setTimeout(() => window.clearInterval(id), 30_000);
    return () => {
      window.clearInterval(id);
      window.clearTimeout(stop);
    };
  }, [stillWaiting, tiers]);

  return (
    <>
      <h1 className="text-2xl font-medium">Thank you! 🎉</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Payment confirmed. Here's what you unlocked:
      </p>

      <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/5 p-6 text-left shadow-[var(--shadow-glow-pink)]">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
          Your plan
        </div>
        <div className="mt-1 font-display text-2xl font-extrabold">{planLabel}</div>

        <dl className="mt-5 space-y-3 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Access begins</dt>
            <dd className="font-medium">
              {tiers.loading ? "…" : start ?? "Today"}
            </dd>
          </div>
          {isLifetime ? (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Expires</dt>
              <dd className="font-medium">Never — Lifetime</dd>
            </div>
          ) : (
            <div className="flex justify-between gap-3">
              <dt className="text-muted-foreground">Next renewal / ends</dt>
              <dd className="font-medium">
                {tiers.loading ? "…" : expires ?? "Finalising…"}
              </dd>
            </div>
          )}
        </dl>

        {(isLifetime || planId === "all_access_12mo_monthly_aud") && (
          <div className="mt-5 rounded-lg border border-primary/30 bg-primary/10 p-3 text-xs text-primary/90">
            <div className="font-semibold uppercase tracking-widest">Perks unlocked</div>
            <ul className="mt-2 space-y-1 text-left">
              <li>· 1 free event entry</li>
              {isLifetime && <li>· 1 free 30-min private-room session</li>}
            </ul>
          </div>
        )}

        {stillWaiting && (
          <p className="mt-4 text-[11px] text-muted-foreground">
            Finalising your access — this refreshes automatically as soon as
            Stripe confirms with our server.
          </p>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <Link
          to={destination as "/library"}
          className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
        >
          Enter the library
        </Link>
        <Link
          to="/store"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Back to store
        </Link>
      </div>
    </>
  );
}

/**
 * Post-checkout summary for private-room bookings. Reads the booking row
 * (RLS-scoped to the current user) that the checkout flow held before
 * payment. Shows date, time, duration, party size, notes, and amount —
 * with a friendly "finalising" state while the webhook flips the row from
 * `pending` to `confirmed`.
 */
function PrivateRoomConfirmation({ sessionId }: { sessionId: string }) {
  const q = useQuery({
    queryKey: ["private-room-booking", sessionId],
    retry: 3,
    refetchInterval: (query) => {
      const data = query.state.data as { status?: string } | null | undefined;
      return data && data.status === "confirmed" ? false : 3000;
    },
    queryFn: () => getMyPrivateRoomBookingBySession({ data: { sessionId } }),
  });

  const b = q.data;
  const starts = b ? new Date(b.starts_at) : null;
  const ends = b && starts ? new Date(starts.getTime() + b.duration_minutes * 60_000) : null;
  const amount =
    b?.amount_cents != null
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: (b.currency ?? "aud").toUpperCase(),
        }).format(b.amount_cents / 100)
      : null;

  return (
    <>
      <h1 className="text-2xl font-medium">You're booked in! 🎉</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Payment confirmed. A calendar invite and receipt are on their way.
      </p>

      {q.isLoading ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading booking details…</p>
      ) : q.isError || !b ? (
        <p className="mt-6 text-sm text-muted-foreground">
          We couldn't load your booking details. Check your dashboard shortly — it
          will appear as soon as our server finishes processing.
        </p>
      ) : (
        <div className="mt-6 rounded-2xl border border-primary/40 bg-primary/5 p-6 text-left shadow-[var(--shadow-glow-pink)]">
          <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
            Your private room booking
          </div>
          <div className="mt-1 font-display text-2xl font-extrabold">
            {b.duration_minutes === 30 ? "30-minute session" : "1-hour session"}
          </div>

          <dl className="mt-5 space-y-3 text-sm">
            <ConfRow label="Date">
              {starts ? format(starts, "EEEE, d MMMM yyyy") : "—"}
            </ConfRow>
            <ConfRow label="Time">
              {starts && ends
                ? `${format(starts, "h:mm a")} – ${format(ends, "h:mm a")}`
                : "—"}
            </ConfRow>
            <ConfRow label="Party size">
              {b.party_size ?? 1} {(b.party_size ?? 1) === 1 ? "guest" : "guests"}
            </ConfRow>
            {amount && <ConfRow label="Amount paid">{amount}</ConfRow>}
            <ConfRow label="Status">
              <span
                className={
                  b.status === "confirmed"
                    ? "rounded-full bg-primary/20 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-primary"
                    : "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground"
                }
              >
                {b.status === "confirmed" ? "Confirmed" : "Finalising…"}
              </span>
            </ConfRow>
            <ConfRow label="Booking ID">
              <span className="font-mono text-[11px]">{b.id.slice(0, 8)}</span>
            </ConfRow>
          </dl>

          {b.notes && (
            <div className="mt-5">
              <div className="text-xs uppercase tracking-widest text-muted-foreground">
                Your notes
              </div>
              <div className="mt-1 whitespace-pre-wrap rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-sm">
                {b.notes}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-col gap-2">
        <Link
          to="/dashboard"
          className="rounded-md bg-primary px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
        >
          Go to your dashboard
        </Link>
        <Link
          to="/private-room"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Book another session
        </Link>
      </div>
    </>
  );
}

function ConfRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium text-right">{children}</dd>
    </div>
  );
}


