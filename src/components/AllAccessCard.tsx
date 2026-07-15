import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { createBillingPortalSession } from "@/lib/billing.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { track } from "@/lib/track";
import { useMyTiers, type PlanId } from "@/hooks/useMyTiers";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

/**
 * All-Access Pass tier picker + optional billing portal button.
 * Extracted from /store so it can render standalone on /all-access-pass
 * and elsewhere without dragging in store-specific chrome.
 */
export function AllAccessCard() {
  const passes: Array<{
    label: string;
    price: string;
    cadence: string;
    perk?: string;
    plan: PlanId;
  }> = [
    { label: "Monthly", price: "A$10", cadence: "/month", perk: "Billed monthly · cancel anytime", plan: "all_access_monthly_aud" },
    { label: "3-Month Term", price: "A$27", cadence: "upfront", perk: "Auto-renewal · 3 months of access", plan: "all_access_3mo_monthly_aud" },
    { label: "6-Month Term", price: "A$48", cadence: "upfront", perk: "Auto-renewal · 6 months of access", plan: "all_access_6mo_monthly_aud" },
    { label: "12-Month Term", price: "A$84", cadence: "upfront", perk: "Auto-renewal · 12 months of access · + 1 free ticketed event", plan: "all_access_12mo_monthly_aud" },
    { label: "Lifetime", price: "A$500", cadence: "one-time", perk: "One-time payment · + 1 free ticketed event & 1 free private room session", plan: "lifetime_onetime_aud" },
  ];

  const tiers = useMyTiers();
  const hasLifetime = tiers.active.lifetime_onetime_aud;
  const TIER_RANK: Record<PlanId, number> = {
    all_access_monthly_aud: 1,
    all_access_3mo_monthly_aud: 2,
    all_access_6mo_monthly_aud: 3,
    all_access_12mo_monthly_aud: 4,
    lifetime_onetime_aud: 5,
  };
  const currentPlan: PlanId | null = hasLifetime
    ? "lifetime_onetime_aud"
    : tiers.active.all_access_12mo_monthly_aud
      ? "all_access_12mo_monthly_aud"
      : tiers.active.all_access_6mo_monthly_aud
        ? "all_access_6mo_monthly_aud"
        : tiers.active.all_access_3mo_monthly_aud
          ? "all_access_3mo_monthly_aud"
          : tiers.active.all_access_monthly_aud
            ? "all_access_monthly_aud"
            : null;
  const currentLabel = currentPlan
    ? passes.find((p) => p.plan === currentPlan)?.label ?? null
    : null;
  const fmtExpiry = (iso?: string | null) => {
    if (!iso) return null;
    try {
      return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch {
      return null;
    }
  };

  return (
    <TooltipProvider>
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
          <ul className="mt-2 grid gap-2 text-sm grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
            {passes.map((p) => {
              const owned = tiers.active[p.plan];
              const supersededByLifetime = hasLifetime && p.plan !== "lifetime_onetime_aud";
              const disabled = owned || supersededByLifetime;
              const expiry = fmtExpiry(tiers.expires[p.plan]);
              const start = fmtExpiry(tiers.starts[p.plan]);
              const willCancel = !!tiers.cancelAtPeriodEnd[p.plan];
              const isLifetime = p.plan === "lifetime_onetime_aud";
              let changeLabel: "Upgrade" | "Downgrade" | "Switch" | null = null;
              if (currentPlan && !owned && !supersededByLifetime) {
                const delta = TIER_RANK[p.plan] - TIER_RANK[currentPlan];
                changeLabel = delta > 0 ? "Upgrade" : delta < 0 ? "Downgrade" : "Switch";
              }
              const badge = owned
                ? isLifetime
                  ? "Owned"
                  : "Active"
                : supersededByLifetime
                  ? "Included"
                  : changeLabel;

              const cadenceText =
                p.cadence === "/month"
                  ? " per month"
                  : p.cadence === "upfront"
                    ? " upfront"
                    : p.cadence === "one-time"
                      ? " one-time"
                      : "";
              const renewalText = owned && !isLifetime && expiry
                ? `${willCancel ? "Ends" : "Renews"} ${expiry}`
                : null;
              const ariaLabel = [
                `${p.label}, ${p.price}${cadenceText}`,
                p.perk,
                badge ? `${badge} plan` : null,
                renewalText,
                disabled ? "Current plan" : "Select this plan",
              ]
                .filter(Boolean)
                .join(". ");

              const row = (
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-3">
                    <span
                      className={cn(
                        "text-foreground",
                        !disabled && !isLifetime && "group-hover:text-primary",
                        isLifetime && "font-display font-bold tracking-wide text-gold",
                      )}
                    >
                      {p.label}
                    </span>
                    <span className={cn("font-display font-bold", isLifetime && "text-base text-gold")}>
                      {p.price}
                      <span
                        className={cn(
                          "ml-1 text-[10px] font-normal text-muted-foreground",
                          isLifetime && "text-[11px] font-semibold text-gold",
                        )}
                      >
                        {p.cadence}
                      </span>
                    </span>
                  </div>
                  {p.perk && !disabled && !changeLabel && (
                    ["all_access_3mo_monthly_aud", "all_access_6mo_monthly_aud", "all_access_12mo_monthly_aud"].includes(p.plan) ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 text-[10px] text-primary/90 cursor-help">
                            {p.perk}
                            <HelpCircle className="h-3 w-3" aria-hidden="true" />
                            <span className="sr-only">Auto-renewal details</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="max-w-[260px] text-center leading-relaxed">
                          Term plans auto-renew at the end of each term. You can cancel or switch plans anytime via the billing portal — changes take effect at your next renewal.
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span
                        className={cn(
                          "text-[10px] text-primary/90",
                          isLifetime && "text-[11px] font-medium text-gold",
                        )}
                      >
                        {p.perk}
                      </span>
                    )
                  )}
                  {badge && <span className="text-[10px] text-primary/90">{badge}</span>}
                  {owned && isLifetime && start && (
                    <span className="text-[10px] text-muted-foreground">
                      Started {start} · never expires
                    </span>
                  )}
                  {owned && !isLifetime && (start || expiry) && (
                    <span className="text-[10px] text-muted-foreground">
                      {start ? `Started ${start}` : null}
                      {start && expiry ? " · " : ""}
                      {expiry ? `${willCancel ? "Ends" : "Renews"} ${expiry}` : null}
                    </span>
                  )}
                  {isLifetime && !disabled && (
                    <span className="mt-2 inline-flex items-center justify-center rounded-full bg-gold-gradient px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-black animate-cta-pulse">
                      Buy Lifetime
                    </span>
                  )}
                  {!isLifetime && !disabled && (
                    <span className="mt-1 text-[10px] font-medium text-primary group-hover:underline">
                      Select plan
                    </span>
                  )}
                </div>
              );

              const trackPayload = {
                plan: p.plan,
                label: p.label,
                price: p.price,
                cadence: p.cadence,
                owned,
                superseded_by_lifetime: supersededByLifetime,
                current_plan: currentPlan ?? "none",
                change: changeLabel ?? "new",
              };

              const lifetimeWrapClass = isLifetime
                ? "relative mt-2 rounded-xl border-2 border-transparent bg-[oklch(0.18_0.05_60_/_0.35)] p-0.5 animate-lifetime-glow"
                : "";

              const inner = disabled ? (
                <div
                  aria-disabled="true"
                  role="button"
                  aria-label={ariaLabel}
                  tabIndex={0}
                  onClick={() => track("boutique_tier_click", { ...trackPayload, action: "blocked" })}
                  className={cn(
                    "-mx-2 flex cursor-not-allowed flex-col gap-0.5 rounded-lg px-2 py-1.5 opacity-60",
                    isLifetime && "mx-0 opacity-80",
                  )}
                >
                  {row}
                </div>
              ) : (
                <Link
                  to="/store/subscribe"
                  search={{ plan: p.plan }}
                  aria-label={ariaLabel}
                  onClick={() => {
                    track("all_access_tier_click", { plan: p.plan, change: changeLabel ?? "new" });
                    track("boutique_tier_click", { ...trackPayload, action: "navigate" });
                  }}
                  className={cn(
                    "group -mx-2 flex flex-col gap-0.5 rounded-lg px-2 py-1.5 hover:bg-primary/15 focus:bg-primary/15 focus:outline-none",
                    isLifetime && "mx-0 rounded-lg px-3 py-2 hover:bg-[oklch(0.85_0.17_85_/_0.08)] focus:bg-[oklch(0.85_0.17_85_/_0.08)]",
                  )}
                >
                  {row}
                </Link>
              );

              return (
                <li key={p.plan}>
                  {isLifetime ? (
                    <div className={lifetimeWrapClass}>
                      <span className="animate-badge-shimmer absolute -top-2 -right-2 z-10 rounded-full bg-gold-gradient px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-black shadow-lg">
                        ★ Best Value
                      </span>
                      {inner}
                    </div>
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
          <div className="mt-3 text-[11px] text-muted-foreground">
            {currentPlan
              ? hasLifetime
                ? "You have Lifetime — everything's unlocked."
                : "Change plan anytime — upgrades and downgrades take effect at your next renewal."
              : "Everything in the library."}
          </div>
        </div>
        {currentPlan && <ManageBillingButton />}
      </div>
    </TooltipProvider>
  );
}

function ManageBillingButton() {
  const openPortal = useServerFn(createBillingPortalSession);
  const [pending, setPending] = useState(false);
  const onClick = async () => {
    if (pending) return;
    setPending(true);
    try {
      track("billing_portal_open_click", {});
      const returnUrl = typeof window !== "undefined" ? `${window.location.origin}/store` : undefined;
      const res = await openPortal({
        data: { environment: getStripeEnvironment(), returnUrl },
      });
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open billing portal");
    } finally {
      setPending(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className="group rounded-2xl border border-primary/50 bg-background/40 p-4 text-left hover:border-primary hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Billing</div>
      <div className="mt-1 font-display text-lg font-bold">
        {pending ? "Opening…" : "Manage subscription & payment method"}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">
        Opens your billing overview.
      </div>
    </button>
  );
}
