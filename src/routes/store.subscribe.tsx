import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

export const Route = createFileRoute("/store/subscribe")({
  head: () => ({
    meta: [
      { title: "All-Access Pass — Princess Pink" },
      { name: "description", content: "$10/month for streaming access to every photo set and video." },
    ],
  }),
  component: SubscribePage,
});

function SubscribePage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const { openCheckout, checkoutElement, isOpen, closeCheckout } = useStripeCheckout();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      if (data.user) setUser({ id: data.user.id, email: data.user.email ?? undefined });
    });
  }, []);

  function subscribe() {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    openCheckout({
      priceId: "all_access_monthly",
      userId: user.id,
      customerEmail: user.email,
      returnUrl: `${window.location.origin}/library?checkout=success`,
    });
  }

  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-3xl px-5 pt-10 pb-16">
        <Link to="/store" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Store
        </Link>

        {isOpen ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-display text-lg">Checkout</div>
              <button onClick={closeCheckout} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
            {checkoutElement}
          </div>
        ) : (
          <div className="mt-6 rounded-3xl border border-primary/40 bg-gradient-to-br from-primary/10 via-background to-background p-8 shadow-[var(--shadow-glow-pink)]">
            <div className="text-xs uppercase tracking-[0.3em] text-primary">All-Access Pass</div>
            <h1 className="mt-2 font-display text-5xl font-extrabold">$10<span className="text-lg text-muted-foreground">/month</span></h1>
            <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
              <li>· Every photo set &amp; video, streaming in-app</li>
              <li>· New drops unlocked automatically</li>
              <li>· Cancel anytime from your library</li>
            </ul>
            <button
              onClick={subscribe}
              className="mt-8 w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
            >
              Subscribe
            </button>
          </div>
        )}
      </section>
    </>
  );
}
