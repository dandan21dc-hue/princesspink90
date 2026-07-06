import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState, Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { getSubscribePrices, type SubscribePrice } from "@/lib/subscribePrices.functions";
import { getStripeEnvironment } from "@/lib/stripe";

type PriceId =
  | "all_access_monthly_aud"
  | "all_access_3mo_onetime_aud"
  | "all_access_6mo_onetime_aud"
  | "all_access_12mo_onetime_aud"
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
        if ("error" in result) return {} as Record<string, SubscribePrice>;
        return result.prices;
      } catch {
        // Never blank the page if Stripe is unreachable or a price is missing;
        // the UI falls back to hard-coded labels so every plan stays visible.
        return {} as Record<string, SubscribePrice>;
      }
    },
    staleTime: 60_000,
  });
}

export const Route = createFileRoute("/store/subscribe")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "All-Access Pass — Princess Pink" },
      {
        name: "description",
        content:
          "Monthly, 3-, 6-, or 12-month all-access passes, plus a lifetime membership. Stream every photo set and video.",
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
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const { openCheckout, checkoutElement, isOpen, closeCheckout } = useStripeCheckout();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email ?? undefined });
    });
  }, []);

  function buy(priceId: PriceId) {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    openCheckout({
      priceId,
      userId: user.id,
      customerEmail: user.email,
      returnUrl: `${window.location.origin}/checkout/return?next=%2Flibrary`,
    });
  }

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
            <Passes onBuy={buy} />
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

function Passes({ onBuy }: { onBuy: (id: PriceId) => void }) {
  const { data: prices } = useSuspenseQuery(pricesQuery());

  return (
    <>
      <h1 className="mt-4 font-display text-4xl font-extrabold sm:text-5xl">
        Choose your all-access pass
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Every plan streams the full members-only photo &amp; video library.
      </p>

      {/* Monthly & term passes */}
      <div className="mt-8 grid gap-4 md:grid-cols-4">
        <PassCard
          label="Monthly"
          price={priceLabel(prices, "all_access_monthly_aud", "A$10")}
          cadence="/month"
          perks={["Full library streaming", "Cancel anytime"]}
          cta="Subscribe"
          onClick={() => onBuy("all_access_monthly_aud")}
        />
        <PassCard
          label="3-Month Pass"
          price={priceLabel(prices, "all_access_3mo_onetime_aud", "A$27")}
          cadence="one-time"
          perks={["Full library for 3 months", "No auto-renew"]}
          cta="Buy 3-month"
          onClick={() => onBuy("all_access_3mo_onetime_aud")}
        />
        <PassCard
          label="6-Month Pass"
          price={priceLabel(prices, "all_access_6mo_onetime_aud", "A$48")}
          cadence="one-time"
          perks={["Full library for 6 months", "No auto-renew"]}
          cta="Buy 6-month"
          onClick={() => onBuy("all_access_6mo_onetime_aud")}
        />
        <PassCard
          label="12-Month Pass"
          price={priceLabel(prices, "all_access_12mo_onetime_aud", "A$84")}
          cadence="one-time"
          highlight="Includes free entry"
          perks={[
            "Full library for 12 months",
            "1 free event entry during the term",
            "No auto-renew",
          ]}
          cta="Buy 12-month"
          onClick={() => onBuy("all_access_12mo_onetime_aud")}
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
          <span className="text-lg text-muted-foreground"> one-time</span>
        </h2>
        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          <li>· <span className="text-foreground">Forever access</span> to all photos &amp; videos</li>
          <li>· <span className="text-foreground">1 free ticket</span> to any event I host (no expiry)</li>
          <li>· <span className="text-foreground">1 private 30-min session</span> with me (no anal) + a picture &amp; video bundle delivered after</li>
          <li>· No recurring charges, ever</li>
        </ul>
        <button
          onClick={() => onBuy("lifetime_onetime_aud")}
          className="mt-8 w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 md:w-auto"
        >
          Buy lifetime
        </button>
      </div>

      {/* Panty Drawer */}
      <div className="mt-12">
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
          <PassCard
            label="24 Hours Worn"
            price={priceLabel(prices, "panty_24hr_aud", "A$60")}
            cadence="+ shipping"
            perks={["Worn 24 hours", "Sealed pouch", "Signed thank-you note"]}
            cta="Buy 24hr"
            onClick={() => onBuy("panty_24hr_aud")}
          />
          <PassCard
            label="48 Hours Worn"
            price={priceLabel(prices, "panty_48hr_aud", "A$90")}
            cadence="+ shipping"
            perks={["Worn 48 hours", "Sealed pouch", "Signed thank-you note"]}
            cta="Buy 48hr"
            onClick={() => onBuy("panty_48hr_aud")}
          />
          <PassCard
            label="72 Hours Worn"
            price={priceLabel(prices, "panty_72hr_aud", "A$120")}
            cadence="+ shipping"
            highlight="Popular"
            perks={["Worn 72 hours", "Sealed pouch", "Handwritten note + polaroid"]}
            cta="Buy 72hr"
            onClick={() => onBuy("panty_72hr_aud")}
          />
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
  highlight,
}: {
  label: string;
  price: string;
  cadence: string;
  perks: string[];
  cta: string;
  onClick: () => void;
  highlight?: string;
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
        className="mt-5 w-full rounded-md bg-primary px-4 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
      >
        {cta}
      </button>
    </div>
  );
}
