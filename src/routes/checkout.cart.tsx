import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createCartCheckoutSession } from "@/lib/store.functions";
import { useCart, formatMoney, cart as cartStore } from "@/lib/cart";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { track } from "@/lib/track";

export const Route = createFileRoute("/checkout/cart")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Checkout — Princess Pink" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CartCheckoutPage,
});

async function detectCountry(): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
    const text = await res.text();
    const match = /^loc=([A-Z]{2})/m.exec(text);
    return match?.[1];
  } catch {
    return undefined;
  }
}

function CartCheckoutPage() {
  const navigate = useNavigate();
  const { items, subtotalCents, hasPanty, currency } = useCart();
  const [user, setUser] = useState<{ id: string; email?: string } | null | undefined>(undefined);
  const [country, setCountry] = useState<string | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) =>
      setUser(
        data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null,
      ),
    );
  }, []);
  useEffect(() => {
    detectCountry().then(setCountry);
  }, []);

  // Bounce to /auth if signed out.
  useEffect(() => {
    if (user === null) navigate({ to: "/auth" });
  }, [user, navigate]);

  // Snapshot the cart at mount so the drawer can't mutate it mid-checkout.
  const [snapshot] = useState(() => cartStore.snapshot());
  const returnPath = snapshot.some((it) => it.kind === "panty") ? "/dashboard" : "/library";
  const returnUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/checkout/return?next=${encodeURIComponent(returnPath)}`
      : `/checkout/return?next=${encodeURIComponent(returnPath)}`;

  const canCheckout = snapshot.length > 0 && !!user;

  const fetchClientSecret = async (): Promise<string> => {
    const fail = (reason: string, message?: string) => {
      track("stripe_checkout_session_failed", {
        kind: "cart",
        source: "cart",
        environment: getStripeEnvironment(),
        item_count: snapshot.length,
        has_panty: snapshot.some((it) => it.kind === "panty"),
        reason,
        ...(message && { message: message.slice(0, 200) }),
      });
    };
    let result;
    try {
      const clientOrderRef =
        typeof window !== "undefined"
          ? sessionStorage.getItem("pp_cart_client_order_ref") ?? undefined
          : undefined;
      result = await createCartCheckoutSession({
        data: {
          items: snapshot.map((it) => ({
            kind: it.kind,
            id: it.id,
            quantity: it.quantity,
          })) as any,
          customerEmail: user?.email,
          returnUrl,
          environment: getStripeEnvironment(),
          customerCountry: country,
          ...(clientOrderRef && { clientOrderRef }),
        },
      });
    } catch (e) {
      fail("exception", (e as Error)?.message);
      throw e;
    }
    if ("error" in result) {
      fail("server_error", String(result.error));
      throw new Error(result.error);
    }
    if (!result.clientSecret) {
      fail("no_client_secret");
      throw new Error("Stripe did not return a client secret");
    }
    return result.clientSecret;
  };

  if (snapshot.length === 0 && items.length === 0) {
    return (
      <>
        <PaymentTestModeBanner />
        <section className="mx-auto max-w-md px-5 py-24 text-center">
          <h1 className="font-display text-2xl">Your cart is empty</h1>
          <p className="mt-2 text-sm text-muted-foreground">Add something before checking out.</p>
          <Link
            to="/store"
            className="mt-6 inline-block rounded-md bg-primary px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground"
          >
            Browse the boutique
          </Link>
        </section>
      </>
    );
  }

  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-5xl px-5 pt-8 pb-16">
        <Link
          to="/store"
          onClick={() => {
            if (snapshot.length === 0) return;
            const hasPantyNow = snapshot.some((it) => it.kind === "panty");
            track("panty_checkout_cancelled", {
              source: "checkout_page",
              reason: "back_to_store",
              stage: "pre_payment",
              item_count: snapshot.length,
              unit_count: snapshot.reduce((n, it) => n + it.quantity, 0),
              subtotal_cents: snapshot.reduce(
                (n, it) => n + it.unit_amount_cents * it.quantity,
                0,
              ),
              currency: snapshot[0]?.currency ?? "aud",
              has_panty: hasPantyNow,
            });
          }}
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Store
        </Link>

        <h1 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">Checkout</h1>

        <div className="mt-8 grid gap-8 md:grid-cols-[1fr_360px]">
          <div className="min-h-[520px] rounded-2xl border border-border/60 bg-card p-4">
            {canCheckout ? (
              <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            ) : user === undefined ? (
              <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
            ) : null}
          </div>

          <aside className="h-fit rounded-2xl border border-border/60 bg-card/60 p-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Order summary</div>
            <ul className="mt-3 space-y-2 text-sm">
              {snapshot.map((it) => (
                <li key={`${it.kind}:${it.id}`} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate">{it.title}</div>
                    <div className="text-xs text-muted-foreground">Qty {it.quantity}</div>
                  </div>
                  <div className="shrink-0 tabular-nums">
                    {formatMoney(it.unit_amount_cents * it.quantity, it.currency)}
                  </div>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-sm">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-semibold tabular-nums">
                {formatMoney(subtotalCents, currency)}
              </span>
            </div>
            {hasPanty && (
              <p className="mt-3 text-[11px] text-muted-foreground">
                Discreet AU shipping (A$15) is added at checkout.
              </p>
            )}
          </aside>
        </div>
      </section>
    </>
  );
}
