import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Info, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { track } from "@/lib/track";
import { useMyTiers, type PlanId } from "@/hooks/useMyTiers";
import { cn } from "@/lib/utils";
import { createNowpaymentsInvoice } from "@/lib/nowpayments.functions";
import { listActiveAllAccessTiers } from "@/lib/all-access-tiers.functions";
import { getStripeEnvironment } from "@/lib/stripe";

/**
 * All-Access Pass tier picker. Every tier — including its price, cadence,
 * and inclusions blurb — comes from the editable `all_access_pass_tiers`
 * table so admins can adjust everything from the admin dashboard without
 * a redeploy. Every purchase is a one-time NOWPayments hosted-invoice
 * checkout; nothing auto-renews.
 */
export function AllAccessCard() {
  const listTiers = useServerFn(listActiveAllAccessTiers);
  const tiersQuery = useQuery({
    queryKey: ["all-access-tiers", "active"],
    queryFn: () => listTiers(),
    staleTime: 60_000,
  });

  const passes: Array<{
    label: string;
    price: string;
    cadence: string;
    perk?: string;
    plan: PlanId;
    priceId?: string;
  }> = (tiersQuery.data ?? []).map((t) => ({
    label: t.label,
    price: t.price_display,
    cadence: t.cadence,
    perk: t.perk ?? undefined,
    plan: t.plan_id as PlanId,
    ...(t.price_id ? { priceId: t.price_id } : {}),
  }));

  const tiers = useMyTiers();
  const hasLifetime = tiers.active.lifetime_onetime_aud;
  const currentPlan: PlanId | null = hasLifetime
    ? "lifetime_onetime_aud"
    : tiers.active.all_access_365d_aud
      ? "all_access_365d_aud"
      : tiers.active.all_access_180d_aud
        ? "all_access_180d_aud"
        : tiers.active.all_access_90d_aud
          ? "all_access_90d_aud"
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
                    {isLifetime && (
                      <TooltipProvider delayDuration={100}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="mt-2 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-widest text-gold/80 hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 rounded"
                              aria-label="What's included in the Lifetime Pass"
                            >
                              <Info className="h-3 w-3" aria-hidden />
                              What's included
                            </button>
                          </TooltipTrigger>
                          <TooltipContent
                            side="bottom"
                            align="start"
                            className="max-w-[16rem] border-gold/40 bg-[oklch(0.18_0.05_60_/_0.95)] text-[11px] leading-relaxed text-gold/95"
                          >
                            <p className="font-semibold text-gold mb-1">A$600 one-time — includes:</p>
                            <ul className="list-disc pl-4 space-y-0.5">
                              <li>Unlimited lifetime access to the full library</li>
                              <li>1 complimentary ticketed event</li>
                              <li>1 complimentary private room session</li>
                              <li>No renewals, no subscriptions — pay once</li>
                            </ul>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    {owned && isLifetime && start && (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Started {start} · never expires
                      </p>
                    )}
                    {owned && !isLifetime && expiry && (() => {
                      const raw = tiers.expires[p.plan];
                      const days = raw
                        ? Math.max(0, Math.ceil((new Date(raw).getTime() - Date.now()) / 86_400_000))
                        : null;
                      return (
                        <p className="mt-2 text-[10px] text-muted-foreground">
                          {start ? `Started ${start} · ` : ""}Expires {expiry}
                          {days != null && (
                            <span className="ml-1 text-primary">
                              · {days} day{days === 1 ? "" : "s"} left
                            </span>
                          )}
                        </p>
                      );
                    })()}
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
