import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { track } from "@/lib/track";
import { useMyTiers, type PlanId } from "@/hooks/useMyTiers";
import { cn } from "@/lib/utils";
import { createNowpaymentsInvoice } from "@/lib/nowpayments.functions";
import { getStripeEnvironment } from "@/lib/stripe";

/**
 * All-Access Pass tier picker. Every purchase is a one-time NOWPayments
 * hosted-invoice checkout — there are no Stripe fallbacks and nothing
 * auto-renews. Two tiers only:
 *
 *   • 30-day pass  → NOWPayments `aap30d` order (default priceId omitted)
 *   • Lifetime     → NOWPayments `lifetime` order (priceId `lifetime_onetime_aud`)
 *
 * On click we mint a hosted invoice via `createNowpaymentsInvoice` and
 * redirect the browser off-site. Entitlements land asynchronously when the
 * IPN webhook fires.
 */
export function AllAccessCard() {
  const passes: Array<{
    label: string;
    price: string;
    cadence: string;
    perk?: string;
    plan: PlanId;
    /** Passed to createNowpaymentsInvoice. Omitted → server defaults to 30-day pass. */
    priceId?: string;
  }> = [
    {
      label: "30-Day Pass",
      price: "A$10",
      cadence: "one-time",
      perk: "30 days of full library access · pay in crypto",
      plan: "all_access_30d_aud",
    },
    {
      label: "3-Month Pass",
      price: "A$27",
      cadence: "one-time",
      perk: "90 days of full library access · pay in crypto",
      plan: "all_access_90d_aud",
      priceId: "aap_90d_aud",
    },
    {
      label: "6-Month Pass",
      price: "A$50",
      cadence: "one-time",
      perk: "180 days of full library access · pay in crypto",
      plan: "all_access_180d_aud",
      priceId: "aap_180d_aud",
    },
    {
      label: "12-Month Pass",
      price: "A$90",
      cadence: "one-time",
      perk: "365 days of full library access · pay in crypto",
      plan: "all_access_365d_aud",
      priceId: "aap_365d_aud",
    },
    {
      label: "Lifetime",
      price: "A$600",
      cadence: "one-time",
      perk: "Never expires · + 1 ticketed event & 1 private room session",
      plan: "lifetime_onetime_aud",
      priceId: "lifetime_onetime_aud",
    },
  ];

  const tiers = useMyTiers();
  const hasLifetime = tiers.active.lifetime_onetime_aud;
  const currentPlan: PlanId | null = hasLifetime
    ? "lifetime_onetime_aud"
    : tiers.active.all_access_30d_aud
      ? "all_access_30d_aud"
      : null;
  const currentLabel = currentPlan
    ? passes.find((p) => p.plan === currentPlan)?.label ?? null
    : null;

  const fmtDate = (iso?: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return null;
    }
  };

  const startCheckout = useServerFn(createNowpaymentsInvoice);
  const [buyingPlan, setBuyingPlan] = useState<PlanId | null>(null);

  const handleBuy = useCallback(
    async (p: (typeof passes)[number]) => {
      if (buyingPlan) return;
      setBuyingPlan(p.plan);
      track("all_access_checkout_start", { plan: p.plan, provider: "nowpayments" });
      try {
        const environment = getStripeEnvironment();
        const result = await startCheckout({
          data: {
            environment,
            returnOrigin: window.location.origin,
            ...(p.priceId ? { priceId: p.priceId } : {}),
          },
        });
        if ("error" in result) {
          toast.error(`Couldn't start checkout: ${result.error}`);
          setBuyingPlan(null);
          return;
        }
        // Off-site redirect to the NOWPayments hosted invoice page.
        window.location.href = result.invoiceUrl;
      } catch (e) {
        toast.error(`Couldn't start checkout: ${(e as Error).message}`);
        setBuyingPlan(null);
      }
    },
    [buyingPlan, startCheckout],
  );

  return (
    <div className="flex flex-col gap-3 w-full">
      <div className="rounded-2xl border border-primary/50 bg-primary/10 p-4 shadow-[var(--shadow-glow-pink)]">
        <div className="flex items-center justify-between">
          <div className="text-[10px] uppercase tracking-[0.3em] text-primary">All-Access Passes</div>
          {currentLabel && (
            <span className="rounded-full border border-primary/60 bg-primary/20 px-2 py-0.5 text-[9px] uppercase tracking-widest text-primary">
              Your plan: {currentLabel}
            </span>
          )}
        </div>

        <ul className="mt-3 grid gap-3 grid-cols-1 sm:grid-cols-2">
          {passes.map((p) => {
            const owned = tiers.active[p.plan];
            const supersededByLifetime = hasLifetime && p.plan !== "lifetime_onetime_aud";
            const disabled = owned || supersededByLifetime;
            const isLifetime = p.plan === "lifetime_onetime_aud";
            const expiry = fmtDate(tiers.expires[p.plan] ?? null);
            const start = fmtDate(tiers.starts[p.plan] ?? null);
            const busy = buyingPlan === p.plan;

            const badge = owned
              ? isLifetime
                ? "Owned"
                : "Active"
              : supersededByLifetime
                ? "Included with Lifetime"
                : null;

            const ariaLabel = [
              `${p.label}, ${p.price} one-time`,
              p.perk,
              badge ?? "Buy with crypto via NOWPayments",
            ]
              .filter(Boolean)
              .join(". ");

            return (
              <li key={p.plan}>
                <div
                  className={cn(
                    "flex h-full flex-col justify-between gap-3 rounded-xl border p-4",
                    isLifetime
                      ? "border-gold/70 bg-[oklch(0.18_0.05_60_/_0.35)]"
                      : "border-primary/30 bg-primary/5",
                    disabled && "opacity-70",
                  )}
                >
                  <div>
                    <div className="flex items-baseline justify-between gap-3">
                      <span
                        className={cn(
                          "font-display text-lg font-semibold text-foreground",
                          isLifetime && "text-gold",
                        )}
                      >
                        {p.label}
                      </span>
                      <span
                        className={cn(
                          "font-display text-xl font-bold",
                          isLifetime ? "text-gold" : "text-foreground",
                        )}
                      >
                        {p.price}
                        <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                          {p.cadence}
                        </span>
                      </span>
                    </div>
                    {p.perk && (
                      <p
                        className={cn(
                          "mt-2 text-[11px] leading-relaxed",
                          isLifetime ? "text-gold/90" : "text-primary/90",
                        )}
                      >
                        {p.perk}
                      </p>
                    )}
                    {owned && isLifetime && start && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Started {start} · never expires
                      </p>
                    )}
                    {owned && !isLifetime && expiry && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        {start ? `Started ${start} · ` : ""}Expires {expiry}
                      </p>
                    )}
                  </div>

                  <div className="pt-1">
                    {disabled ? (
                      <span className="inline-flex items-center justify-center rounded-full border border-border/60 bg-background/40 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                        {badge ?? "Unavailable"}
                      </span>
                    ) : (
                      <button
                        type="button"
                        aria-label={ariaLabel}
                        aria-busy={busy}
                        disabled={busy || !!buyingPlan}
                        onClick={() => void handleBuy(p)}
                        className={cn(
                          "inline-flex w-full items-center justify-center gap-2 rounded-full px-4 py-2 text-[11px] font-bold uppercase tracking-widest transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60",
                          isLifetime
                            ? "bg-gold-gradient text-black animate-cta-pulse"
                            : "bg-primary text-primary-foreground",
                        )}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                            Redirecting…
                          </>
                        ) : isLifetime ? (
                          "Buy Lifetime · Crypto"
                        ) : (
                          "Buy 30-Day Pass · Crypto"
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="mt-3 text-[11px] text-muted-foreground">
          {currentPlan
            ? hasLifetime
              ? "You have Lifetime — everything's unlocked."
              : "Your 30-day pass is active. Buy again anytime to extend."
            : "Every pass is a one-time crypto payment via NOWPayments — nothing auto-renews."}
        </p>
      </div>
    </div>
  );
}
