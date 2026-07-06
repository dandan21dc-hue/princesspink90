import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState, Suspense } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getSubscribePrices, checkPricesExist, type SubscribePrice } from "@/lib/subscribePrices.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { cart } from "@/lib/cart";
import { track } from "@/lib/track";

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
});

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

  async function buy(priceId: PriceId) {
    if (pending) {
      console.log("[subscribe] click ignored — already pending", { pending, priceId });
      return;
    }
    console.log("[subscribe] click", { priceId, hasUser: !!user });
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
      track("checkout_open", { priceId });
      openCheckout({
        priceId,
        userId: user.id,
        customerEmail: user.email,
        returnUrl: `${window.location.origin}/checkout/return?next=%2Flibrary`,
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

function priceLabel(prices: Record<string, SubscribePrice>, key: PriceId, fallback: string) {
  const p = prices[key];
  if (!p) return fallback;
  return formatMoney(p.unit_amount, p.currency);
}

function Passes({ onBuy, pending }: { onBuy: (id: PriceId) => void; pending: PriceId | null }) {
  const { data: prices } = useSuspenseQuery(pricesQuery());
  const busy = (id: PriceId) => pending === id;
  const disabled = pending !== null;

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
        <PassCard
          label="3-Month Term"
          price={priceLabel(prices, "all_access_3mo_monthly_aud", "A$27")}
          cadence="for 3 months"
          perks={["Full library streaming", "One-time upfront payment", "3 months of access — no renewal"]}
          cta="Buy 3-month term"
          onClick={() => onBuy("all_access_3mo_monthly_aud")}
          loading={busy("all_access_3mo_monthly_aud")}
          disabled={disabled}
        />
        <PassCard
          label="6-Month Term"
          price={priceLabel(prices, "all_access_6mo_monthly_aud", "A$48")}
          cadence="for 6 months"
          perks={["Full library streaming", "One-time upfront payment", "6 months of access — no renewal"]}
          cta="Buy 6-month term"
          onClick={() => onBuy("all_access_6mo_monthly_aud")}
          loading={busy("all_access_6mo_monthly_aud")}
          disabled={disabled}
        />
        <PassCard
          label="12-Month Term"
          price={priceLabel(prices, "all_access_12mo_monthly_aud", "A$84")}
          cadence="for 12 months"
          highlight="Includes free entry"
          perks={[
            "Full library streaming",
            "One-time upfront payment",
            "12 months of access — no renewal",
            "1 free event entry during the term",
          ]}
          cta="Buy 12-month term"
          onClick={() => onBuy("all_access_12mo_monthly_aud")}
          loading={busy("all_access_12mo_monthly_aud")}
          disabled={disabled}
        />
      </div>


      {/* Lifetime */}
      <div className="mt-8 relative overflow-hidden rounded-3xl border-2 border-primary bg-gradient-to-br from-primary/25 via-background to-background p-8 shadow-[var(--shadow-glow-pink)]">
        <div className="absolute right-4 top-4 rounded-full bg-primary px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-primary-foreground">
          Best value
        </div>
        <div className="text-xs uppercase tracking-[0.3em] text-primary">
          Lifetime Membership
        </div>
        <h2 className="mt-2 font-display text-5xl font-extrabold">
          {priceLabel(prices, "lifetime_onetime_aud", "A$500")}
          <span className="text-lg text-muted-foreground"> one-time payment</span>
        </h2>
        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li>· <span className="text-foreground">Forever access</span> to all photos &amp; videos</li>
          <li>· <span className="text-foreground">1 free ticket</span> to any event I host (no expiry)</li>
          <li>· <span className="text-foreground">1 private 30-min session</span> with me (no anal) + a picture &amp; video bundle delivered after</li>
          <li>· No recurring charges, ever</li>
        </ul>
        <button
          onClick={() => onBuy("lifetime_onetime_aud")}
          disabled={disabled}
          className="mt-8 min-h-12 w-full rounded-md bg-primary px-6 py-3.5 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 md:w-auto disabled:cursor-not-allowed disabled:opacity-70"
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

        <div className="mt-6 grid gap-4 md:grid-cols-4">
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
            return (
              <PassCard
                key={p.key}
                label={p.label}
                price={priceLabel(prices, p.key, `A$${(p.fallbackCents / 100).toFixed(0)}`)}
                cadence="+ shipping"
                highlight={p.highlight}
                perks={[...p.perks]}
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

function PassCard({
  label,
  price,
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
  cadence: string;
  perks: string[];
  cta: string;
  onClick: () => void;
  onAddToCart?: () => void;
  highlight?: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  return (
    <div className="relative flex flex-col rounded-2xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-background p-6 shadow-[var(--shadow-glow-pink)]">
      {highlight ? (
        <div className="absolute right-3 top-3 rounded-full bg-primary/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-primary-foreground">
          {highlight}
        </div>
      ) : null}
      <div className="text-[10px] uppercase tracking-[0.3em] text-primary">{label}</div>
      <div className="mt-2 font-display text-3xl font-extrabold">
        {price}
        <span className="ml-1 text-xs font-normal text-muted-foreground">{cadence}</span>
      </div>
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
          onClick={onAddToCart}
          className="mt-2 w-full rounded-md border border-primary/60 px-4 py-2 text-[11px] font-semibold uppercase tracking-widest text-primary hover:bg-primary/10"
        >
          Add to cart
        </button>
      )}
    </div>
  );
}

