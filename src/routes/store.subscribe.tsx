import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

export const Route = createFileRoute("/store/subscribe")({
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

type PriceId =
  | "all_access_monthly_aud"
  | "all_access_3mo_onetime_aud"
  | "all_access_6mo_onetime_aud"
  | "all_access_12mo_onetime_aud"
  | "lifetime_onetime_aud"
  | "panty_24hr_aud"
  | "panty_48hr_aud"
  | "panty_72hr_aud";

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
      returnUrl: `${window.location.origin}/library?checkout=success`,
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
                price="A$10"
                cadence="/month"
                perks={["Full library streaming", "Cancel anytime"]}
                cta="Subscribe"
                onClick={() => buy("all_access_monthly_aud")}
              />
              <PassCard
                label="3-Month Pass"
                price="A$27"
                cadence="one-time"
                perks={["Full library for 3 months", "No auto-renew"]}
                cta="Buy 3-month"
                onClick={() => buy("all_access_3mo_onetime_aud")}
              />
              <PassCard
                label="6-Month Pass"
                price="A$48"
                cadence="one-time"
                perks={["Full library for 6 months", "No auto-renew"]}
                cta="Buy 6-month"
                onClick={() => buy("all_access_6mo_onetime_aud")}
              />
              <PassCard
                label="12-Month Pass"
                price="A$84"
                cadence="one-time"
                highlight="Includes free entry"
                perks={[
                  "Full library for 12 months",
                  "1 free event entry during the term",
                  "No auto-renew",
                ]}
                cta="Buy 12-month"
                onClick={() => buy("all_access_12mo_onetime_aud")}
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
                A$500<span className="text-lg text-muted-foreground"> one-time</span>
              </h2>
              <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
                <li>
                  · <span className="text-foreground">Forever access</span> to all photos
                  &amp; videos
                </li>
                <li>
                  · <span className="text-foreground">1 free ticket</span> to any event I
                  host (no expiry)
                </li>
                <li>
                  · <span className="text-foreground">1 private session</span> with me (no
                  anal)
                </li>
                <li>· No recurring charges, ever</li>
              </ul>
              <button
                onClick={() => buy("lifetime_onetime_aud")}
                className="mt-8 w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 md:w-auto"
              >
                Buy lifetime
              </button>
            </div>

          </>
        )}
      </section>
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
