import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCart, formatMoney, cart as cartStore, cartLineKey, isCartItemIdValid, type CartItem } from "@/lib/cart";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { getMyRewards } from "@/lib/rewards.functions";
import { useServerFn } from "@tanstack/react-start";
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
  const fetchRewards = useServerFn(getMyRewards);

  // Reward-point redemption state. Balance is loaded once the user is
  // known; `appliedPoints` is what the shopper has committed via the
  // Apply button, and gets attached to the NEXT panty item they check
  // out. Discount is fixed at 10 pts = $1.00 (100 cents).
  const [rewardPoints, setRewardPoints] = useState<number | null>(null);
  const [pointsInput, setPointsInput] = useState<string>("");
  const [appliedPoints, setAppliedPoints] = useState<number>(0);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) =>
      setUser(
        data.user ? { id: data.user.id, email: data.user.email ?? undefined } : null,
      ),
    );
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchRewards()
      .then((r) => setRewardPoints(r.reward_points ?? 0))
      .catch(() => setRewardPoints(0));
  }, [user, fetchRewards]);

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

  // Cap the discount so it can never exceed the largest panty item's
  // price minus $1.00 (NOWPayments minimum invoice). Non-panty items
  // don't currently accept points.
  const maxPantyCents = useMemo(() => {
    return snapshot
      .filter((it) => it.kind === "panty")
      .reduce((max, it) => Math.max(max, it.unit_amount_cents), 0);
  }, [snapshot]);
  const maxRedeemable = Math.max(
    0,
    Math.min(rewardPoints ?? 0, Math.floor((maxPantyCents - 100) / 10)),
  );
  const discountCents = appliedPoints * 10;

  const handleApplyPoints = () => {
    const n = Math.floor(Number(pointsInput));
    if (!Number.isFinite(n) || n <= 0) {
      toast.error("Enter a positive number of points to redeem.");
      return;
    }
    if (rewardPoints == null) {
      toast.error("Loading your balance — try again in a moment.");
      return;
    }
    if (n > rewardPoints) {
      toast.error(`You only have ${rewardPoints} reward points.`);
      return;
    }
    if (maxPantyCents === 0) {
      toast.error("Reward points can only be applied to boutique items right now.");
      return;
    }
    if (n > maxRedeemable) {
      toast.error(
        `Max ${maxRedeemable} points for this cart (invoice must stay above $1.00).`,
      );
      return;
    }
    setAppliedPoints(n);
    toast.success(`${n} points applied — ${formatMoney(n * 10, currency)} off your next payment.`);
  };

  const handleClearPoints = () => {
    setAppliedPoints(0);
    setPointsInput("");
  };

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
    // Reward points only apply to panty items and only once (to the
    // first item paid). Clear the applied points after use so the same
    // discount can't be attached to a second invoice.
    const canApplyPoints =
      it.kind === "panty" && appliedPoints > 0 && appliedPoints * 10 < it.unit_amount_cents;
    track("nowpayments_cart_checkout_click", {
      kind: it.kind,
      id: it.id,
      unit_amount_cents: it.unit_amount_cents,
      points_applied: canApplyPoints ? appliedPoints : 0,
    });
    const opts: Parameters<typeof openCheckout>[0] =
      it.kind === "panty"
        ? { pantyListingId: it.id, ...(canApplyPoints ? { pointsToApply: appliedPoints } : {}) }
        : { contentItemId: it.id };
    if (canApplyPoints) {
      // Optimistically clear so a re-click on another item doesn't
      // double-apply. Server-side reservation is the authoritative guard.
      setAppliedPoints(0);
      setPointsInput("");
    }
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
        {snapshot.map((it) => {
          // Per-line guard: a bad id here is a mid-session race (cross-tab
          // write, tampered storage) since mount-time hydration already
          // pruned the persisted list. Flag it inline instead of silently
          // showing a Pay button that will 400 at the server.
          const invalidId = !isCartItemIdValid(it);
          const payDisabled = isOpen || invalidId;
          return (
            <li
              key={cartLineKey(it)}
              className="flex items-center justify-between gap-4 rounded-2xl border border-border/60 bg-card p-4"
              data-invalid-id={invalidId ? "true" : undefined}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="truncate font-medium">{it.title}</div>
                  {invalidId && (
                    <span
                      role="status"
                      aria-label={`${it.title} can't be checked out`}
                      className="shrink-0 rounded-full border border-destructive/40 bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-destructive"
                    >
                      Can't check out
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground">
                  {it.size ? <>Size {it.size} · </> : null}Qty {it.quantity} ·{" "}
                  {formatMoney(it.unit_amount_cents * it.quantity, it.currency)}
                </div>
                {invalidId && (
                  <div className="mt-1 text-[11px] text-destructive">
                    Reference is out of date — remove this item and add the current listing again.
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => payItem(it)}
                disabled={payDisabled}
                aria-disabled={payDisabled}
                title={invalidId ? "This item's reference is out of date" : undefined}
                className="shrink-0 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-60"
              >
                {isOpen ? "Redirecting…" : "Pay with crypto"}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-6 flex items-center justify-between border-t border-border/60 pt-4 text-sm">
        <span className="text-muted-foreground">Cart total</span>
        <span className="font-semibold tabular-nums">{formatMoney(subtotalCents, currency)}</span>
      </div>

      {checkoutElement}
    </section>
  );
}
