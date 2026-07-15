import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCart, formatMoney, cart as cartStore, cartLineKey, isCartItemIdValid, type CartItem } from "@/lib/cart";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { track } from "@/lib/track";
import { toast } from "sonner";


export const Route = createFileRoute("/checkout/cart")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Checkout — Midnight Glory" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: CartCheckoutPage,
});

/**
 * NOWPayments-only cart checkout. Each cart line is paid individually
 * via a hosted NOWPayments invoice — the provider only supports one item
 * per invoice, so we surface a per-item "Pay with crypto" button rather
 * than a combined checkout session.
 */
function CartCheckoutPage() {
  const navigate = useNavigate();
  const { items, subtotalCents, currency } = useCart();
  const [user, setUser] = useState<{ id: string; email?: string } | null | undefined>(undefined);
  const { openCheckout, checkoutElement, isOpen } = useStripeCheckout();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) =>
      setUser(
        data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null,
      ),
    );
  }, []);

  // Bounce to /auth if signed out.
  useEffect(() => {
    if (user === null) navigate({ to: "/auth" });
  }, [user, navigate]);

  // If cart hydration pruned any legacy/tampered items (non-UUID ids the
  // checkout server function would reject), surface a single toast on
  // mount so the shopper knows why the cart shrank instead of silently
  // dropping the row. Runs once — `consumePrunedItems` is idempotent.
  useEffect(() => {
    const pruned = cartStore.consumePrunedItems();
    if (pruned.length === 0) return;
    const titles = pruned.map((it) => it.title).filter(Boolean);
    toast.error(
      pruned.length === 1
        ? "Removed 1 item from your cart"
        : `Removed ${pruned.length} items from your cart`,
      {
        description:
          (titles.length > 0
            ? `${titles.join(", ")} — their references are out of date. `
            : "Their references are out of date. ") +
          "Add the current listings again to check out.",
      },
    );
  }, []);

  // Snapshot the cart at mount so the drawer can't mutate it mid-checkout.
  const [snapshot] = useState(() => cartStore.snapshot());

  const payItem = (it: CartItem) => {
    // Defensive: the cart's `read()` filter already drops entries whose id
    // isn't a UUID, but a race (localStorage tampering, cross-tab write mid-
    // click) could still surface a bad line. Refuse rather than sending a
    // guaranteed-to-fail request to the checkout server function.
    if (!isCartItemIdValid(it)) {
      toast.error("This item can't be checked out", {
        description:
          "Its reference is out of date. Remove it from the cart and add the current listing again.",
      });
      track("cart_checkout_invalid_id", { kind: it.kind, id: String(it.id) });
      return;
    }
    track("nowpayments_cart_checkout_click", {
      kind: it.kind,
      id: it.id,
      unit_amount_cents: it.unit_amount_cents,
    });
    const opts: Parameters<typeof openCheckout>[0] =
      it.kind === "panty"
        ? { pantyListingId: it.id }
        : { contentItemId: it.id };
    void openCheckout(opts);
  };


  if (snapshot.length === 0 && items.length === 0) {
    return (
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
    );
  }

  return (
    <section className="mx-auto max-w-3xl px-5 pt-8 pb-16">
      <Link
        to="/store"
        className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        ← Store
      </Link>

      <h1 className="mt-4 font-display text-3xl font-extrabold sm:text-4xl">Checkout</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Each item is paid separately with crypto via NOWPayments. Choose an item below to
        continue to secure hosted checkout.
      </p>

      <ul className="mt-8 space-y-3">
        {snapshot.map((it) => (
          <li
            key={cartLineKey(it)}
            className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card p-4"
          >
            <div className="min-w-0">
              <div className="truncate font-medium">{it.title}</div>
              <div className="text-xs text-muted-foreground">
                {it.size ? <>Size {it.size} · </> : null}Qty {it.quantity} ·{" "}
                {formatMoney(it.unit_amount_cents * it.quantity, it.currency)}
              </div>
            </div>
            <button
              type="button"
              onClick={() => payItem(it)}
              disabled={isOpen}
              className="shrink-0 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-60"
            >
              {isOpen ? "Redirecting…" : "Pay with crypto"}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4 text-sm">
        <span className="text-muted-foreground">Cart total</span>
        <span className="font-semibold tabular-nums">{formatMoney(subtotalCents, currency)}</span>
      </div>

      {checkoutElement}
    </section>
  );
}
