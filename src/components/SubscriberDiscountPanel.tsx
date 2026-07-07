import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { getSubscriberStatus } from "@/lib/store.functions";
import { getStripeEnvironment } from "@/lib/stripe";

/**
 * Dashboard panel showing the subscriber's remaining 15%-off Panty Drawer
 * allowance as a progress bar plus used-vs-remaining counts. Hidden entirely
 * for non-subscribers so the dashboard stays uncluttered.
 */
export function SubscriberDiscountPanel() {
  const status = useQuery({
    queryKey: ["subscriber-status", getStripeEnvironment()],
    queryFn: () => getSubscriberStatus({ data: { environment: getStripeEnvironment() } }),
    staleTime: 30_000,
  });

  if (status.isLoading) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-5">
        <div className="h-4 w-40 animate-pulse rounded bg-muted" />
        <div className="mt-4 h-2 w-full animate-pulse rounded bg-muted" />
      </div>
    );
  }

  const data = status.data;
  if (!data?.isSubscriber) return null;

  const { discountPercent, discountedOrdersRemaining, discountedOrdersMax } = data;
  const used = discountedOrdersMax - discountedOrdersRemaining;
  const usedPct = Math.round((used / discountedOrdersMax) * 100);
  const active = discountedOrdersRemaining > 0;

  return (
    <div
      className={`rounded-2xl border p-5 ${
        active ? "border-primary/40 bg-primary/5" : "border-border/60 bg-card/60"
      }`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.3em] text-primary">
            Subscriber {discountPercent || 15}% off
          </div>
          <h2 className="mt-1 font-display text-lg">Panty Drawer discount allowance</h2>
        </div>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest ${
            active
              ? "bg-primary/15 text-primary"
              : "bg-muted text-muted-foreground"
          }`}
        >
          {active ? "Active" : "Used up"}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between gap-4">
        <div>
          <div className="font-display text-4xl font-extrabold tabular-nums leading-none text-foreground">
            {discountedOrdersRemaining}
            <span className="text-xl font-normal text-muted-foreground">
              {" "}
              / {discountedOrdersMax}
            </span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            discounted purchase{discountedOrdersRemaining === 1 ? "" : "s"} remaining
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>
            <span className="font-semibold text-foreground tabular-nums">{used}</span> used
          </div>
          <div>
            <span className="font-semibold text-foreground tabular-nums">
              {discountedOrdersRemaining}
            </span>{" "}
            remaining
          </div>
        </div>
      </div>

      <div
        className="mt-4 h-2 w-full overflow-hidden rounded-full bg-border/60"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={discountedOrdersMax}
        aria-valuenow={used}
        aria-label="Subscriber discount purchases used"
      >
        <div
          className={`h-full rounded-full transition-all ${
            active ? "bg-primary" : "bg-muted-foreground/50"
          }`}
          style={{ width: `${usedPct}%` }}
        />
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted-foreground">
        {active ? (
          <>
            Your 15% discount applies automatically at checkout on your first{" "}
            {discountedOrdersMax} paid Panty Drawer orders. After that, purchases
            are charged at full price.
          </>
        ) : (
          <>
            You've used all {discountedOrdersMax} discounted Panty Drawer orders.
            New purchases are charged at full price.
          </>
        )}
      </p>

      <div className="mt-4">
        <Link
          to="/store/subscribe"
          hash="panty-drawer"
          className="inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-widest text-primary hover:underline"
        >
          View Panty Drawer →
        </Link>
      </div>
    </div>
  );
}
