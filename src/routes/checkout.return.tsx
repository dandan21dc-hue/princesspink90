import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getCheckoutSession } from "@/lib/store.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { cart as cartStore } from "@/lib/cart";
import { track } from "@/lib/track";
import { useMyTiers, type PlanId } from "@/hooks/useMyTiers";


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
    const md = session.metadata ?? {};
    const pantyVariant = md.panty_order || (md.cart_panty_items ? "cart" : null);
    if (!pantyVariant) return;
    const status = session.status ?? "unknown";
    const eventName =
      status === "complete"
        ? "panty_checkout_confirmed"
        : status === "open"
          ? "panty_checkout_pending"
          : "panty_checkout_cancelled";
    const key = `${sessionId}:${eventName}`;
    if (trackedRef.current === key) return;
    trackedRef.current = key;
    const basePayload: Record<string, string | number | boolean | undefined> = {
      variant: pantyVariant,
      session_id: sessionId,
      payment_intent_id: session.payment_intent_id ?? undefined,
      client_order_ref: md.client_order_ref ?? undefined,
      total_amount_cents: session.amount_total ?? undefined,
      currency: session.currency ?? undefined,
      status,
      cart_mode: md.cart_mode === "1",
    };
    if (eventName === "panty_checkout_cancelled") {
      track(eventName, {
        ...basePayload,
        source: "checkout_return",
        reason: "return_incomplete",
        stage: "post_return",
      });
    } else {
      track(eventName, basePayload);
    }
  }, [sessionId, session]);

  // Track return-page load failures (session retrieve errored, or Stripe
  // shipped a placeholder session_id back). Separate ref so it can't clash
  // with the panty status event above.
  const errorTrackedRef = useRef<string | null>(null);
  useEffect(() => {
    if (templateNotSubstituted) {
      if (errorTrackedRef.current === "template") return;
      errorTrackedRef.current = "template";
      track("stripe_checkout_return_failed", { reason: "missing_session_id" });
      track("panty_checkout_cancelled", {
        source: "checkout_return",
        reason: "missing_session_id",
        stage: "post_return",
      });
      return;
    }
    if (!query.isError || !sessionId) return;
    const key = `error:${sessionId}`;
    if (errorTrackedRef.current === key) return;
    errorTrackedRef.current = key;
    track("stripe_checkout_return_failed", {
      reason: "session_fetch_error",
      session_id: sessionId,
      message: (query.error as Error)?.message?.slice(0, 200),
    });
    track("panty_checkout_cancelled", {
      source: "checkout_return",
      reason: "session_fetch_error",
      stage: "post_return",
      session_id: sessionId,
    });
  }, [templateNotSubstituted, query.isError, query.error, sessionId]);

  // Auto-redirect only for panty/cart checkouts — subscription and lifetime
  // buyers see a confirmation summary with dates and click through manually.
  const isMembershipPurchase =
    session?.metadata?.membership === "lifetime" ||
    session?.metadata?.membership === "term_pass" ||
    !!session?.metadata?.subscription;
  useEffect(() => {
    if (!isComplete || isMembershipPurchase) return;
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
  }, [isComplete, destination, navigate, session?.metadata?.cart_mode, isMembershipPurchase]);

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
  const stillWaiting = !isLifetime && !planId && !tiers.loading;

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

