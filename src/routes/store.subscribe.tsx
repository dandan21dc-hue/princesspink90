import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery, useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, Suspense } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getSubscribePrices, checkPricesExist, type SubscribePrice } from "@/lib/subscribePrices.functions";
import { getSubscriberStatus, SUBSCRIBER_DISCOUNT_PERCENT } from "@/lib/store.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { cart } from "@/lib/cart";
import { track } from "@/lib/track";
import { listPantyListingsPublic, type PantyListing } from "@/lib/pantyListings.functions";

type PriceId =
  | "all_access_monthly_aud"
  | "all_access_3mo_monthly_aud"
  | "all_access_6mo_monthly_aud"
  | "all_access_12mo_monthly_aud"
  | "lifetime_onetime_aud"
  | "panty_24hr_aud"
  | "panty_48hr_aud"
  | "panty_72hr_aud";

function pricesQuery() {
  return queryOptions({
    queryKey: ["subscribe-prices", getStripeEnvironment()],
    queryFn: async () => {
      try {
        const result = await getSubscribePrices({ data: { environment: getStripeEnvironment() } });
        if ("error" in result) {
          track("stripe_prices_fetch_failed", {
            environment: getStripeEnvironment(),
            reason: "server_error",
            message: String(result.error).slice(0, 200),
          });
          return {} as Record<string, SubscribePrice>;
        }
        return result.prices;
      } catch (e) {
        // Never blank the page if Stripe is unreachable or a price is missing;
        // the UI falls back to hard-coded labels so every plan stays visible.
        track("stripe_prices_fetch_failed", {
          environment: getStripeEnvironment(),
          reason: "exception",
          message: (e as Error)?.message?.slice(0, 200),
        });
        return {} as Record<string, SubscribePrice>;
      }
    },
    staleTime: 60_000,
  });
}

const PRESELECTABLE_PLANS: readonly PriceId[] = [
  "all_access_monthly_aud",
  "all_access_3mo_monthly_aud",
  "all_access_6mo_monthly_aud",
  "all_access_12mo_monthly_aud",
  "lifetime_onetime_aud",
];

export const Route = createFileRoute("/store/subscribe")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>): { plan?: PriceId } => {
    const raw = search.plan;
    if (typeof raw === "string" && (PRESELECTABLE_PLANS as readonly string[]).includes(raw)) {
      return { plan: raw as PriceId };
    }
    return {};
  },
  head: () => ({
    meta: [
      { title: "All-Access Pass — Princess Pink" },
      {
        name: "description",
        content:
          "Monthly all-access, 3/6/12-month upfront term passes, or a lifetime membership. Stream every photo set and video.",
      },
    ],
  }),
  component: SubscribePage,
  pendingComponent: PagePending,
  errorComponent: PageError,
  notFoundComponent: PageNotFound,
});

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-5xl px-5 pt-10 pb-16">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Membership</div>
        <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
          Pick your <span className="text-neon">All-Access Pass</span>
        </h1>
        {children}
        <div className="mt-10 text-xs text-muted-foreground">
          <Link to="/store" className="underline hover:text-primary">
            ← Back to store
          </Link>
        </div>
      </section>
    </>
  );
}

function PagePending() {
  return (
    <PageShell>
      <div className="mt-8 space-y-4" role="status" aria-live="polite" aria-busy="true">
        <div className="h-6 w-2/3 animate-pulse rounded-md bg-muted/40" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/30" />
        <span className="sr-only">Loading plans…</span>
      </div>
    </PageShell>
  );
}

function PageError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <PageShell>
      <div role="alert" className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-6">
        <div className="text-xs uppercase tracking-[0.3em] text-destructive">
          Couldn't load plans
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message ?? "Something went wrong loading subscription plans."}
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </PageShell>
  );
}

function PageNotFound() {
  return (
    <PageShell>
      <p className="mt-8 text-sm text-muted-foreground">This page could not be found.</p>
    </PageShell>
  );
}

function formatMoney(cents: number, currency: string): string {
  const value = cents / 100;
  const upper = currency.toUpperCase();
  // AUD → prefix with A$; anything else uses the currency code before amount.
  if (upper === "AUD") {
    return `A$${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: upper }).format(value);
}

function SubscribePage() {
  const navigate = useNavigate();
  const { plan } = Route.useSearch();
  const [user, setUser] = useState<{ id: string; email?: string } | null | undefined>(undefined);
  const [pending, setPending] = useState<PriceId | null>(null);
  const { openCheckout, checkoutElement, isOpen, closeCheckout } = useStripeCheckout();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null);
    });
  }, []);

  async function buy(priceId: PriceId, autoRenew?: boolean) {
    if (pending) {
      console.log("[subscribe] click ignored — already pending", { pending, priceId });
      return;
    }
    console.log("[subscribe] click", { priceId, hasUser: !!user, autoRenew });
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    setPending(priceId);
    try {
      // Preflight: confirm the selected lookup_key actually exists in
      // Stripe before opening embedded checkout, so a missing/renamed
      // price shows a clear error instead of a generic checkout failure.
      const result = await checkPricesExist({
        data: { environment: getStripeEnvironment(), lookupKeys: [priceId] },
      });
      if ("error" in result) {
        console.error("[subscribe] preflight failed", result.error);
        toast.error(`Couldn't verify pricing: ${result.error}`);
        return;
      }
      if (result.missing.length > 0) {
        console.warn("[subscribe] price missing", { priceId, missing: result.missing });
        track("stripe_price_missing", { priceId, missing: result.missing.join(",") });
        toast.error(
          `This plan (${priceId}) is temporarily unavailable. Please try another option or contact support.`,
        );
        return;
      }
      if (priceId.startsWith("panty_")) {
        track("panty_checkout_started", { variant: priceId });
      }
      track("checkout_open", { priceId, autoRenew: autoRenew ? "1" : "0" });
      openCheckout({
        priceId,
        userId: user.id,
        customerEmail: user.email,
        returnUrl: `${window.location.origin}/checkout/return?next=%2Flibrary`,
        autoRenew,
      });
    } catch (e) {
      console.error("[subscribe] buy failed", e);
      toast.error(`Couldn't start checkout: ${(e as Error).message}`);
    } finally {
      setPending(null);
    }
  }


  // Preselect: if the route arrived with ?plan=..., auto-open Stripe checkout
  // for that tier once auth has resolved. Signed-out visitors are bounced
  // to /auth by buy(); if they return to this URL after signing in, the
  // effect re-fires and completes checkout.
  const preselectedRef = useRef<PriceId | null>(null);
  useEffect(() => {
    if (!plan || user === undefined || isOpen) return;
    if (preselectedRef.current === plan) return;
    preselectedRef.current = plan;
    buy(plan);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, user, isOpen]);

  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-6xl px-5 pt-10 pb-16">
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
          <Suspense fallback={<div className="mt-10 text-sm text-muted-foreground">Loading pricing…</div>}>
            <Passes onBuy={buy} pending={pending} />
          </Suspense>
        )}
      </section>
    </>
  );
}

function priceLabel(prices: Record<string, SubscribePrice>, key: PriceId, fallback: string, multiplier = 1) {
  const p = prices[key];
  if (!p) return fallback;
  return formatMoney(p.unit_amount * multiplier, p.currency);
}

function Passes({ onBuy, pending }: { onBuy: (id: PriceId, autoRenew?: boolean) => void; pending: PriceId | null }) {
  const { data: prices } = useSuspenseQuery(pricesQuery());
  const busy = (id: PriceId) => pending === id;
  const disabled = pending !== null;

  // Subscriber-only Panty Drawer discount. Server-side is source of truth
  // (Stripe coupon applied at checkout for gated buyers); this query only
  // drives the UI label + badge so subscribers see the reduced price up front.
  const subStatus = useQuery({
    queryKey: ["subscriber-status", getStripeEnvironment()],
    queryFn: () => getSubscriberStatus({ data: { environment: getStripeEnvironment() } }),
    staleTime: 30_000,
  });
  const isSubscriber = subStatus.data?.isSubscriber === true;
  const discountPercent = subStatus.data?.discountPercent ?? SUBSCRIBER_DISCOUNT_PERCENT;
  const discountedOrdersRemaining = subStatus.data?.discountedOrdersRemaining ?? 0;
  const discountedOrdersMax = subStatus.data?.discountedOrdersMax ?? 3;
  const hasActiveDiscount = isSubscriber && discountPercent > 0;

  function pantyPriceDisplay(fallbackCents: number, priceObj?: SubscribePrice) {
    const currency = (priceObj?.currency ?? "aud").toLowerCase();
    const unitCents = priceObj?.unit_amount ?? fallbackCents;
    const original = formatMoney(unitCents, currency);
    if (!hasActiveDiscount) return { display: original, original: null as string | null };
    const discounted = Math.round(unitCents * (100 - discountPercent) / 100);
    return { display: formatMoney(discounted, currency), original };
  }


  return (
    <>
      <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-5xl">
        Choose your all-access pass
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every plan streams the full members-only photo &amp; video library.
      </p>

      {/* Monthly & term passes */}
      <div className="mt-8 grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <PassCard
          label="Monthly"
          price={priceLabel(prices, "all_access_monthly_aud", "A$10")}
          cadence="/month"
          perks={["Full library streaming", "Billed monthly · cancel anytime"]}
          cta="Subscribe"
          onClick={() => onBuy("all_access_monthly_aud")}
          loading={busy("all_access_monthly_aud")}
          disabled={disabled}
        />
        <TermPassCard
          label="3-Month Term"
          termMonths={3}
          priceId="all_access_3mo_monthly_aud"
          priceText={priceLabel(prices, "all_access_3mo_monthly_aud", "A$27", 3)}
          onBuy={onBuy}
          loading={busy("all_access_3mo_monthly_aud")}
          disabled={disabled}
        />
        <TermPassCard
          label="6-Month Term"
          termMonths={6}
          priceId="all_access_6mo_monthly_aud"
          priceText={priceLabel(prices, "all_access_6mo_monthly_aud", "A$48", 6)}
          onBuy={onBuy}
          loading={busy("all_access_6mo_monthly_aud")}
          disabled={disabled}
        />
        <TermPassCard
          label="12-Month Term"
          termMonths={12}
          priceId="all_access_12mo_monthly_aud"
          priceText={priceLabel(prices, "all_access_12mo_monthly_aud", "A$84", 12)}
          highlight="Includes free entry"
          extraPerks={["1 free event entry during the term"]}
          onBuy={onBuy}
          loading={busy("all_access_12mo_monthly_aud")}
          disabled={disabled}
        />
      </div>



      {/* Lifetime */}
      <div
        className="mt-8 relative overflow-visible rounded-3xl border-2 p-6 sm:p-8 bg-gradient-to-br from-primary/25 via-background to-background"
        style={{
          borderColor: "#f5c542",
          boxShadow:
            "0 0 0 1px rgba(245,197,66,0.55), 0 0 40px rgba(245,197,66,0.35), 0 0 80px rgba(245,197,66,0.2), var(--shadow-glow-pink)",
        }}
      >
        {/* Glowing gold BEST VALUE badge */}
        <span
          className="absolute -top-3 right-4 sm:right-6 z-10 rounded-full px-3 py-1 text-[10px] font-black uppercase tracking-[0.2em] text-black animate-pulse"
          style={{
            background: "linear-gradient(135deg, #ffe27a 0%, #f5c542 45%, #d4a017 100%)",
            boxShadow:
              "0 0 12px rgba(245,197,66,0.9), 0 0 24px rgba(245,197,66,0.6), 0 0 40px rgba(245,197,66,0.4)",
          }}
        >
          ★ Best Value
        </span>

        <div className="flex flex-wrap items-center gap-2 pr-24 sm:pr-28">
          <div className="text-xs uppercase tracking-[0.3em] text-primary">
            Lifetime Membership
          </div>
        </div>
        <h2 className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-display text-4xl font-extrabold sm:text-5xl">
          <span>{priceLabel(prices, "lifetime_onetime_aud", "A$00")}</span>
          <span
            className="font-semibold text-lg sm:text-xl"
            style={{ color: "#f5c542", textShadow: "0 0 10px rgba(245,197,66,0.5)" }}
          >
            one-time payment
          </span>
        </h2>

        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li>· <span className="text-foreground">Forever access</span> to all photos &amp; videos</li>
          <li>· <span className="text-foreground">1 free ticket</span> to any event I host (no expiry)</li>
          <li>· <span className="text-foreground">1 private 60-min session</span> with me (no anal)&nbsp;</li>
          <li>· No recurring charges, ever</li>
        </ul>
        <button
          onClick={() => onBuy("lifetime_onetime_aud")}
          disabled={disabled}
          className="mt-8 min-h-14 w-full rounded-lg bg-primary px-8 py-4 text-base sm:text-lg font-bold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 md:w-auto disabled:cursor-not-allowed disabled:opacity-70 animate-pulse hover:animate-none transition"
        >
          {busy("lifetime_onetime_aud") ? "Processing…" : "Buy lifetime"}
        </button>

      </div>

      {/* Panty Drawer */}
      <div id="panty-drawer" className="mt-12 scroll-mt-24">
        <div className="flex items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-primary">
              The Panty Drawer
            </div>
            <h2 className="mt-1 font-display text-3xl font-extrabold sm:text-4xl">
              For your extra kinky side 💋
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Worn, sealed, shipped discreetly across Australia. Shipping (A$15)
              added at checkout.
            </p>
          </div>
        </div>

        <PantyGallery />

        <div id="panty-buy-cards" className="mt-6 grid gap-4 md:grid-cols-4">

          {(
            [
              { key: "panty_24hr_aud", label: "24 Hours Worn", fallbackCents: 6000, perks: ["Worn 24 hours", "Sealed pouch", "Signed thank-you note"], cta: "Buy 24hr", highlight: undefined as string | undefined },
              { key: "panty_48hr_aud", label: "48 Hours Worn", fallbackCents: 9000, perks: ["Worn 48 hours", "Sealed pouch", "Signed thank-you note"], cta: "Buy 48hr", highlight: undefined as string | undefined },
              { key: "panty_72hr_aud", label: "72 Hours Worn", fallbackCents: 12000, perks: ["Worn 72 hours", "Sealed pouch", "Handwritten note + Free picture of the panties worn"], cta: "Buy 72hr", highlight: "Popular" as string | undefined },
            ] as const
          ).map((p) => {
            const priceObj = prices[p.key];
            const unitCents = priceObj?.unit_amount ?? p.fallbackCents;
            const currency = (priceObj?.currency ?? "aud").toLowerCase();
            const { display, original } = pantyPriceDisplay(p.fallbackCents, priceObj);
            return (
              <PassCard
                key={p.key}
                label={p.label}
                price={display}
                originalPrice={original ?? undefined}
                subscriberBadge={hasActiveDiscount}
                cadence="+ shipping"
                highlight={p.highlight}
                perks={[
                  ...p.perks,
                  ...(hasActiveDiscount
                    ? [`Subscriber ${discountPercent}% off — ${discountedOrdersRemaining} of ${discountedOrdersMax} discounted orders left`]
                    : isSubscriber
                      ? [`You've used all ${discountedOrdersMax} subscriber-discount orders — now at full price`]
                      : []),
                ]}
                cta={p.cta}
                loading={busy(p.key)}
                disabled={disabled}
                onClick={() => {
                  track("panty_buy_click", { variant: p.key, price_cents: unitCents, currency });
                  onBuy(p.key);
                }}
                onAddToCart={() => {
                  const existingPanty = cart.snapshot().find((it) => it.kind === "panty");
                  const replacing = existingPanty && existingPanty.id !== p.key;
                  console.log("[cart] add panty", { variant: p.key, replacing });
                  try {
                    cart.add({
                      kind: "panty",
                      id: p.key,
                      title: `${p.label} panty`,
                      unit_amount_cents: unitCents,
                      currency,
                    });
                    track("panty_add_to_cart", { variant: p.key, price_cents: unitCents, currency });
                    toast.success(replacing ? `Swapped for ${p.label}` : "Added to cart");
                  } catch (e) {
                    console.error("[cart] add failed", e);
                    toast.error((e as Error).message);
                  }
                }}
              />
            );

          })}

          <div className="relative flex flex-col rounded-2xl border border-dashed border-primary/40 bg-background/40 p-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
              Custom Order
            </div>
            <div className="mt-2 font-display text-2xl font-extrabold">Ask nicely</div>
            <p className="mt-4 flex-1 text-xs text-muted-foreground">
              Specific style, colour, wear time, or add-ons? Send a private
              request and I'll quote you back.
            </p>
            <Link
              to="/support"
              className="mt-5 w-full rounded-md border border-primary/60 px-4 py-2.5 text-center text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/10"
            >
              Enquire
            </Link>
          </div>
        </div>

        <p className="mt-4 text-[11px] text-muted-foreground">
          18+ only. Australia-only shipping. All sales final; discreet plain
          packaging.
        </p>
      </div>
    </>
  );
}

function PantyGallery() {
  const q = useQuery({
    queryKey: ["panty-listings-public"],
    queryFn: () => listPantyListingsPublic(),
    staleTime: 60_000,
  });
  const [lightbox, setLightbox] = useState<PantyListing | null>(null);
  const listings = q.data ?? [];

  if (!q.isLoading && listings.length === 0) return null;

  return (
    <div className="mt-6">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h3 className="font-display text-xl font-bold">Available pairs</h3>
          <p className="text-xs text-muted-foreground">
            Real pairs currently in the drawer. Tap a pair to preview, then buy below by wear time.
          </p>
        </div>
        {listings.length > 0 && (
          <span className="text-[10px] uppercase tracking-widest text-primary">
            {listings.length} available
          </span>
        )}
      </div>

      {q.isLoading ? (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="aspect-square animate-pulse rounded-lg bg-muted/30" />
          ))}
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {listings.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => {
                setLightbox(l);
                track("panty_listing_open", { listing_id: l.id });
              }}
              className="group overflow-hidden rounded-lg border border-primary/30 bg-card/40 text-left hover:border-primary"
            >
              <div className="aspect-square bg-muted/20">
                {l.cover_url ? (
                  <img
                    src={l.cover_url}
                    alt={l.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition group-hover:scale-[1.02]"
                  />
                ) : (
                  <div className="grid h-full place-items-center text-xs text-muted-foreground">
                    No photo
                  </div>
                )}
              </div>
              <div className="p-2">
                <div className="truncate text-xs font-semibold">{l.title}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {[l.color, l.style, l.size].filter(Boolean).join(" · ") || "\u00a0"}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {lightbox && (
        <PantyLightbox listing={lightbox} onClose={() => setLightbox(null)} />
      )}
    </div>
  );
}

function PantyLightbox({
  listing,
  onClose,
}: {
  listing: PantyListing;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const gallery = [
    ...(listing.cover_url ? [listing.cover_url] : []),
    ...listing.media_urls,
  ];
  const current = gallery[idx] ?? listing.cover_url;
  const scrollToCards = () => {
    onClose();
    setTimeout(() => {
      document
        .getElementById("panty-buy-cards")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-border bg-background"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative aspect-square w-full bg-black">
          {current && (
            <img
              src={current}
              alt={listing.title}
              className="h-full w-full object-contain"
            />
          )}
          {gallery.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => setIdx((i) => (i - 1 + gallery.length) % gallery.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-white"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setIdx((i) => (i + 1) % gallery.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-white"
              >
                ›
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white">
                {idx + 1} / {gallery.length}
              </div>
            </>
          )}
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-display text-xl font-bold">{listing.title}</h4>
              <div className="mt-1 text-xs text-muted-foreground">
                {[listing.color, listing.style, listing.size].filter(Boolean).join(" · ") || "—"}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Close
            </button>
          </div>
          {listing.description && (
            <p className="mt-3 whitespace-pre-line text-sm text-muted-foreground">
              {listing.description}
            </p>
          )}
          <button
            type="button"
            onClick={scrollToCards}
            className="mt-5 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
          >
            Pick a wear time & buy
          </button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Once sold, this pair is removed from the gallery.
          </p>
        </div>
      </div>
    </div>
  );
}



function PassCard({
  label,
  price,
  originalPrice,
  subscriberBadge = false,
  cadence,
  perks,
  cta,
  onClick,
  onAddToCart,
  highlight,
  loading = false,
  disabled = false,
}: {
  label: string;
  price: string;
  originalPrice?: string;
  subscriberBadge?: boolean;
  cadence: string;
  perks: string[];
  cta: string;
  onClick: () => void;
  onAddToCart?: () => void;
  highlight?: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="relative flex flex-col rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-background p-6 shadow-[var(--shadow-glow-pink)]">
      {highlight ? (
        <div className="absolute right-3 top-3 rounded-full bg-primary/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary-foreground">
          {highlight}
        </div>
      ) : null}
      <div className="flex items-center gap-2">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">{label}</div>
        {subscriberBadge && (
          <span
            className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-black"
            style={{
              background: "linear-gradient(135deg, #ffe27a 0%, #f5c542 45%, #d4a017 100%)",
              boxShadow: "0 0 8px rgba(245,197,66,0.6)",
            }}
          >
            Subscriber Price
          </span>
        )}
      </div>
      <div className="mt-2 font-display text-3xl font-extrabold">
        {price}
        <span className="ml-1 text-xs font-normal text-muted-foreground">{cadence}</span>
      </div>
      {originalPrice && (
        <div className="mt-0.5 text-xs text-muted-foreground line-through">
          {originalPrice}
        </div>
      )}
      <ul className="mt-4 flex-1 space-y-1.5 text-xs text-muted-foreground">
        {perks.map((p) => (
          <li key={p}>· {p}</li>
        ))}
      </ul>
      <button
        onClick={onClick}
        disabled={disabled || loading}
        className="mt-5 min-h-11 w-full rounded-md bg-primary px-4 py-3 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? "Processing…" : cta}
      </button>
      {onAddToCart && (
        <button
          onClick={() => {
            if (adding) return;
            setAdding(true);
            try {
              onAddToCart();
            } finally {
              // Brief lockout to prevent double-taps racing the cart mutation.
              setTimeout(() => setAdding(false), 600);
            }
          }}
          disabled={adding}
          className="mt-2 w-full rounded-md border border-primary/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {adding ? "Adding…" : "Add to cart"}
        </button>
      )}
    </div>
  );
}

function TermPassCard({
  label,
  termMonths,
  priceId,
  priceText,
  onBuy,
  loading,
  disabled,
  highlight,
  extraPerks = [],
}: {
  label: string;
  termMonths: 3 | 6 | 12;
  priceId: PriceId;
  priceText: string;
  onBuy: (id: PriceId, autoRenew?: boolean) => void;
  loading: boolean;
  disabled: boolean;
  highlight?: string;
  extraPerks?: string[];
}) {
  // Default to auto-renew ON so subscribers keep uninterrupted access.
  // Toggle lets them opt into a one-time, non-renewing purchase instead.
  const [autoRenew, setAutoRenew] = useState(true);

  const perks = [
    "Full library streaming",
    autoRenew
      ? `Auto-renews every ${termMonths} months at ${priceText} — cancel anytime`
      : `One-time payment · ${termMonths} months of access · no renewal`,
    ...extraPerks,
  ];
  const cadence = `for ${termMonths} months`;
  const cta = autoRenew
    ? `Subscribe · ${priceText}/${termMonths}mo`
    : `Buy ${termMonths}-month term`;

  return (
    <div className="relative flex flex-col rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-background p-6 shadow-[var(--shadow-glow-pink)]">
      {highlight ? (
        <div className="absolute right-3 top-3 rounded-full bg-primary/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary-foreground">
          {highlight}
        </div>
      ) : null}
      <div className="text-[10px] uppercase tracking-[0.3em] text-primary">{label}</div>
      <div className="mt-2 font-display text-3xl font-extrabold">
        {priceText}
        <span className="ml-1 text-xs font-normal text-muted-foreground">{cadence}</span>
      </div>
      <ul className="mt-4 flex-1 space-y-1.5 text-xs text-muted-foreground">
        {perks.map((p) => (
          <li key={p}>· {p}</li>
        ))}
      </ul>

      <label className="mt-4 flex cursor-pointer items-start gap-2 rounded-md border border-primary/30 bg-background/60 px-3 py-2 text-[11px] text-foreground/90 hover:bg-primary/5">
        <input
          type="checkbox"
          className="mt-0.5 h-3.5 w-3.5 accent-primary"
          checked={autoRenew}
          onChange={(e) => setAutoRenew(e.target.checked)}
          disabled={disabled || loading}
        />
        <span>
          <span className="font-semibold">Auto-renew</span> at term end
          <span className="ml-1 text-muted-foreground">(uncheck to pay once)</span>
        </span>
      </label>

      <button
        onClick={() => onBuy(priceId, autoRenew)}
        disabled={disabled || loading}
        className="mt-3 min-h-11 w-full rounded-md bg-primary px-4 py-3 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
      >
        {loading ? "Processing…" : cta}
      </button>
    </div>
  );
}



