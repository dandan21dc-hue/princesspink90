import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { ShoppingBag, Trash2, Minus, Plus } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useCart, formatMoney, cart as cartStore } from "@/lib/cart";
import { cn } from "@/lib/utils";
import { track } from "@/lib/track";

export function CartButton() {
  const { count } = useCart();
  const [open, setOpen] = useState(false);
  // Set true when the user clicks the Checkout button so the drawer's
  // subsequent close doesn't get logged as an abandonment.
  const checkoutStartedRef = useRef(false);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Drawer transitioning from open → closed without the checkout button
        // being clicked = the user closed the drawer with items still inside.
        if (open && !next && !checkoutStartedRef.current) {
          const snap = cartStore.snapshot();
          if (snap.length > 0) {
            const hasPantyNow = snap.some((it) => it.kind === "panty");
            const unitCount = snap.reduce((n, it) => n + it.quantity, 0);
            const subtotalCents = snap.reduce(
              (n, it) => n + it.unit_amount_cents * it.quantity,
              0,
            );
            track("panty_checkout_cancelled", {
              source: "cart_drawer",
              reason: "drawer_closed",
              stage: "pre_checkout",
              item_count: snap.length,
              unit_count: unitCount,
              subtotal_cents: subtotalCents,
              currency: snap[0]?.currency ?? "aud",
              has_panty: hasPantyNow,
            });
          }
        }
        if (next) checkoutStartedRef.current = false;
        setOpen(next);
      }}
    >
      <SheetTrigger asChild>
        <button
          aria-label={`Cart (${count} item${count === 1 ? "" : "s"})`}
          className="relative inline-flex items-center justify-center rounded-md px-2.5 py-2 text-muted-foreground hover:text-foreground transition"
        >
          <ShoppingBag className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 py-0.5 text-[10px] font-bold text-primary-foreground shadow-[var(--shadow-glow-pink)]">
              {count}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="font-display text-2xl">Your cart</SheetTitle>
          <SheetDescription>
            One-time items only. Subscriptions and private-room bookings check out on their own page.
          </SheetDescription>
        </SheetHeader>
        <CartBody
          onClose={() => setOpen(false)}
          onCheckoutStart={() => {
            checkoutStartedRef.current = true;
          }}
        />
      </SheetContent>
    </Sheet>
  );
}

function CartBody({ onClose, onCheckoutStart }: { onClose: () => void; onCheckoutStart?: () => void }) {
  const { items, subtotalCents, hasPanty, currency, setQty, remove, clear } = useCart();
  const [checkingOut, setCheckingOut] = useState(false);
  const navigate = useNavigate();

  if (items.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
        <ShoppingBag className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">Your cart is empty.</p>
        <Link
          to="/store"
          onClick={onClose}
          className="mt-2 rounded-md border border-primary/60 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/10"
        >
          Browse the boutique
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto py-4">
        <ul className="space-y-3">
          {items.map((it) => (
            <li
              key={`${it.kind}:${it.id}`}
              className="flex gap-3 rounded-xl border border-border/60 bg-card/60 p-3"
            >
              <div className="h-16 w-16 shrink-0 overflow-hidden rounded-md bg-secondary/40">
                {it.cover_url ? (
                  <img src={it.cover_url} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] uppercase text-muted-foreground">
                    {it.kind === "panty" ? "🩲" : "PP"}
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{it.title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  {formatMoney(it.unit_amount_cents, it.currency)}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <button
                    type="button"
                    aria-label="Decrease quantity"
                    onClick={() => setQty(it.kind, it.id, it.quantity - 1)}
                    className="rounded-md border border-border/60 p-1 hover:bg-secondary/50"
                  >
                    <Minus className="h-3 w-3" />
                  </button>
                  <span className="min-w-[1.5rem] text-center text-sm tabular-nums">
                    {it.quantity}
                  </span>
                  <button
                    type="button"
                    aria-label="Increase quantity"
                    onClick={() => setQty(it.kind, it.id, it.quantity + 1)}
                    className="rounded-md border border-border/60 p-1 hover:bg-secondary/50"
                  >
                    <Plus className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    aria-label="Remove"
                    onClick={() => remove(it.kind, it.id)}
                    className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="text-sm font-semibold tabular-nums">
                {formatMoney(it.unit_amount_cents * it.quantity, it.currency)}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="border-t border-border/60 pt-4">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Subtotal</span>
          <span className="font-semibold tabular-nums">
            {formatMoney(subtotalCents, currency)}
          </span>
        </div>
        {hasPanty && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            Discreet AU shipping (A$15) will be added at checkout. Address collected on the next step.
          </p>
        )}
        <button
          type="button"
          disabled={checkingOut || items.length === 0}
          onClick={() => {
            if (checkingOut) return;
            setCheckingOut(true);
            // Correlation id links the pre-checkout analytics event to the
            // Stripe session that the /checkout/cart page will create, so
            // pending/confirmed/incomplete return-page events can be joined
            // back to the original click with no PII.
            const clientOrderRef =
              typeof crypto !== "undefined" && "randomUUID" in crypto
                ? crypto.randomUUID()
                : `co_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
            try {
              sessionStorage.setItem("pp_cart_client_order_ref", clientOrderRef);
            } catch {
              // sessionStorage disabled — event still fires, correlation just
              // won't round-trip through Stripe metadata.
            }
            track("panty_checkout_start", {
              source: "cart",
              client_order_ref: clientOrderRef,
              item_count: items.length,
              unit_count: items.reduce((n, it) => n + it.quantity, 0),
              subtotal_cents: subtotalCents,
              total_amount_cents: subtotalCents,
              currency,
              has_panty: hasPanty,
              items: JSON.stringify(
                items.map((it) => ({
                  kind: it.kind,
                  id: it.id,
                  title: it.title,
                  quantity: it.quantity,
                  unit_amount_cents: it.unit_amount_cents,
                  currency: it.currency,
                })),
              ),
            });
            onCheckoutStart?.();
            onClose();
            navigate({ to: "/checkout/cart" });
          }}
          className={cn(
            "mt-4 min-h-11 w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70",
          )}
        >
          {checkingOut ? "Processing…" : `Checkout · ${formatMoney(subtotalCents, currency)}`}
        </button>
        <button
          type="button"
          onClick={clear}
          className="mt-2 w-full text-center text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Clear cart
        </button>
      </div>
    </>
  );
}
