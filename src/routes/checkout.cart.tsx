import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { supabase } from "@/integrations/supabase/client";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createCartCheckoutSession, getSubscriberStatus } from "@/lib/store.functions";
import { useCart, formatMoney, cart as cartStore, cartLineKey } from "@/lib/cart";
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
  const subStatus = useQuery({
    queryKey: ["subscriber-status", getStripeEnvironment(), user?.id ?? null],
    queryFn: () => getSubscriberStatus({ data: { environment: getStripeEnvironment() } }),
    enabled: !!user && hasPanty,
    staleTime: 30_000,
  });


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

  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Pre-fetch the Stripe client secret so real server errors (e.g. the
  // members-only Panty Drawer gate) surface in-page instead of being
  // swallowed by Stripe's generic "Something went wrong" screen.
  useEffect(() => {
    if (!user || snapshot.length === 0 || clientSecret || checkoutError) return;
    let cancelled = false;
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
    (async () => {
      try {
        const clientOrderRef =
          typeof window !== "undefined"
            ? sessionStorage.getItem("pp_cart_client_order_ref") ?? undefined
            : undefined;
        const result = await createCartCheckoutSession({
          data: {
            items: snapshot.map((it) => ({
              kind: it.kind,
              id: it.id,
              quantity: it.quantity,
            })) as any,
            customerEmail: user.email,
            returnUrl,
            environment: getStripeEnvironment(),
            customerCountry: country,
            ...(clientOrderRef && { clientOrderRef }),
          },
        });
        if (cancelled) return;
        if ("error" in result) {
          fail("server_error", String(result.error));
          setCheckoutError(String(result.error));
          return;
        }
        if (!result.clientSecret) {
          fail("no_client_secret");
          setCheckoutError("Stripe did not return a client secret.");
          return;
        }
        setClientSecret(result.clientSecret);
      } catch (e) {
        const msg = (e as Error)?.message || "Failed to start checkout.";
        fail("exception", msg);
        if (!cancelled) setCheckoutError(msg);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, snapshot, country, returnUrl, clientSecret, checkoutError]);

  const fetchClientSecret = async (): Promise<string> => {
    if (clientSecret) return clientSecret;
    throw new Error(checkoutError ?? "Checkout is not ready yet.");
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
            {user && clientSecret ? (
              <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
                <EmbeddedCheckout />
              </EmbeddedCheckoutProvider>
            ) : (
              <div className="p-10 text-center text-sm text-muted-foreground">Loading…</div>
            )}
          </div>




          <aside className="h-fit rounded-2xl border border-border/60 bg-card/60 p-5">
            <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Order summary</div>
            {hasPanty && subStatus.data?.isSubscriber && (() => {
              const { discountedOrdersRemaining, discountedOrdersMax, discountPercent } = subStatus.data;
              const pantyQty = snapshot
                .filter((it) => it.kind === "panty")
                .reduce((n, it) => n + it.quantity, 0);
              const used = discountedOrdersMax - discountedOrdersRemaining;
              const willUse = Math.min(pantyQty, discountedOrdersRemaining);
              const afterOrder = Math.max(0, discountedOrdersRemaining - willUse);
              const pct = Math.round((used / discountedOrdersMax) * 100);
              const active = discountedOrdersRemaining > 0;
              return (
                <div
                  role="status"
                  aria-live="polite"
                  className={`mt-3 rounded-lg border p-3 ${
                    active ? "border-primary/40 bg-primary/5" : "border-border/60 bg-muted/30"
                  }`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-primary">
                      Subscriber {discountPercent}% off
                    </div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      {active ? "Active" : "Used up"}
                    </div>
                  </div>
                  <div className="mt-2 flex items-end justify-between gap-3">
                    <div>
                      <div className="font-display text-3xl font-extrabold tabular-nums leading-none text-foreground">
                        {discountedOrdersRemaining}
                        <span className="text-lg font-normal text-muted-foreground"> / {discountedOrdersMax}</span>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        discounted order{discountedOrdersRemaining === 1 ? "" : "s"} remaining
                      </div>
                    </div>
                    {active && willUse > 0 && (
                      <div className="text-right text-[11px] leading-tight text-muted-foreground">
                        <div>Using <span className="font-semibold text-foreground">{willUse}</span> now</div>
                        <div>
                          {afterOrder > 0
                            ? <>Then <span className="font-semibold text-foreground">{afterOrder}</span> left</>
                            : <span className="font-semibold text-foreground">Last discount</span>}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.min(100, pct + (willUse / discountedOrdersMax) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })()}

            <ul className="mt-3 space-y-2 text-sm">
              {snapshot.map((it) => (
                <li key={cartLineKey(it)} className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate">{it.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {it.size ? <>Size {it.size} · </> : null}Qty {it.quantity}
                    </div>
                  </div>
                  <div className="shrink-0 tabular-nums">
                    {formatMoney(it.unit_amount_cents * it.quantity, it.currency)}
                  </div>
                </li>
              ))}
            </ul>
            {(() => {
              const status = subStatus.data;
              const eligible =
                hasPanty && !!status?.isSubscriber && (status?.discountedOrdersRemaining ?? 0) > 0;
              const discountPercent = status?.discountPercent ?? 15;
              const discountCents = eligible
                ? Math.round((subtotalCents * discountPercent) / 100)
                : 0;
              const estimatedTotal = subtotalCents - discountCents;
              const notAppliedReason = !hasPanty
                ? null
                : !status
                  ? null
                  : !status.isSubscriber
                    ? "Subscribers only"
                    : status.discountedOrdersRemaining <= 0
                      ? `${status.discountedOrdersMax}/${status.discountedOrdersMax} discounted orders used`
                      : null;

              return (
                <>
                  <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3 text-sm">
                    <span className="text-muted-foreground">Subtotal</span>
                    <span className="font-semibold tabular-nums">
                      {formatMoney(subtotalCents, currency)}
                    </span>
                  </div>
                  {eligible && (
                    <div className="mt-1 flex items-center justify-between text-sm">
                      <span className="text-primary">Subscriber discount ({discountPercent}%)</span>
                      <span className="font-semibold tabular-nums text-primary">
                        −{formatMoney(discountCents, currency)}
                      </span>
                    </div>
                  )}
                  {!eligible && notAppliedReason && (
                    <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Subscriber discount ({discountPercent}%)</span>
                      <span className="italic">Not applied · {notAppliedReason}</span>
                    </div>
                  )}
                  {eligible && (
                    <div className="mt-2 flex items-center justify-between border-t border-border/40 pt-2 text-sm">
                      <span className="text-muted-foreground">Estimated total</span>
                      <span className="font-semibold tabular-nums">
                        {formatMoney(estimatedTotal, currency)}
                      </span>
                    </div>
                  )}
                  {hasPanty && (
                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Discreet AU shipping (A$15) is added at checkout.
                    </p>
                  )}
                </>
              );
            })()}

            {hasPanty && subStatus.data && (() => {
              const pantyQty = snapshot
                .filter((it) => it.kind === "panty")
                .reduce((n, it) => n + it.quantity, 0);
              const { isSubscriber, discountPercent, discountedOrdersRemaining, discountedOrdersMax } = subStatus.data;
              if (!isSubscriber) {
                return (
                  <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="font-semibold text-foreground">Subscribers save 15%</span> on their first {discountedOrdersMax} Panty Drawer orders.{" "}
                    <Link to="/store/subscribe" className="text-primary underline underline-offset-2">
                      Subscribe to unlock
                    </Link>.
                  </div>
                );
              }
              if (discountedOrdersRemaining <= 0) {
                return (
                  <div className="mt-3 rounded-md border border-border/60 bg-muted/30 p-3 text-[11px] leading-relaxed text-muted-foreground">
                    You've used all {discountedOrdersMax} subscriber-discount Panty Drawer orders. This order is charged at full price.
                  </div>
                );
              }
              const discountedThisOrder = Math.min(pantyQty, discountedOrdersRemaining);
              const afterOrder = Math.max(0, discountedOrdersRemaining - discountedThisOrder);
              return (
                <div className="mt-3 rounded-md border border-primary/40 bg-primary/5 p-3 text-[11px] leading-relaxed text-foreground/90">
                  <div className="font-semibold text-primary">
                    Subscriber {discountPercent}% off applied
                  </div>
                  <p className="mt-1">
                    Discount applies to your first {discountedOrdersMax} Panty Drawer orders. You have{" "}
                    <span className="font-semibold text-foreground">{discountedOrdersRemaining} of {discountedOrdersMax}</span> discounted orders remaining.
                  </p>
                  <p className="mt-1">
                    {pantyQty > discountedOrdersRemaining ? (
                      <>Only {discountedOrdersRemaining} item{discountedOrdersRemaining === 1 ? "" : "s"} in this cart qualify — Stripe will apply the 15% to those and charge the rest at full price.</>
                    ) : afterOrder > 0 ? (
                      <>After this order you'll have <span className="font-semibold text-foreground">{afterOrder}</span> discounted order{afterOrder === 1 ? "" : "s"} left.</>
                    ) : (
                      <>This is your last discounted order — future Panty Drawer purchases will be at full price.</>
                    )}
                  </p>
                </div>
              );
            })()}

          </aside>
        </div>
      </section>
    </>
  );
}
