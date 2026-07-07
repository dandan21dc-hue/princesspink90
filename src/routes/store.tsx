import { createFileRoute, Link, Outlet, useMatches, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { listStoreItems } from "@/lib/store.functions";
import { createBillingPortalSession } from "@/lib/billing.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { track } from "@/lib/track";
import { useMyTiers, type PlanId } from "@/hooks/useMyTiers";
import { cn } from "@/lib/utils";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { X, SlidersHorizontal, HelpCircle } from "lucide-react";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";

export const storeQuery = queryOptions({
  queryKey: ["store-items"],
  queryFn: () => listStoreItems(),
});

const storeSearchSchema = z.object({
  sizes: fallback(z.array(z.string()), []).default([]),
  colors: fallback(z.array(z.string()), []).default([]),
  styles: fallback(z.array(z.string()), []).default([]),
});

export const Route = createFileRoute("/store")({
  validateSearch: zodValidator(storeSearchSchema),
  loader: ({ context }) => context.queryClient.ensureQueryData(storeQuery),
  head: () => ({
    meta: [
      { title: "Store — Princess Pink" },
      {
        name: "description",
        content: "Buy photo sets, videos, and bundles — or subscribe for all-access to Princess Pink's library.",
      },
      { property: "og:title", content: "Princess Pink · Store" },
      { property: "og:description", content: "Photo sets, videos, bundles, and an all-access pass." },
      { property: "og:url", content: "https://princesspink90.lovable.app/store" },
    ],
    links: [{ rel: "canonical", href: "https://princesspink90.lovable.app/store" }],
  }),
  component: StorePage,
  errorComponent: ({ error }) => (
    <div className="p-10 text-center text-sm text-muted-foreground">
      Something went wrong loading the store. {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-10 text-center">Not found.</div>,
});

function StorePage() {
  // /store is both a leaf page AND a layout parent for /store/subscribe,
  // /store/private-room, /store/$id. When a child route matches, render only
  // the child so the boutique landing content doesn't leak into every child.
  const matches = useMatches();
  const isChild = matches.some((m) => m.routeId !== "__root__" && m.routeId !== "/store" && m.routeId.startsWith("/store"));
  if (isChild) return <Outlet />;

  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-6xl px-5 pt-10 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-primary">Boutique</div>
            <h1 className="mt-2 font-display text-4xl font-extrabold">
              Buy my <span className="text-neon">pictures &amp; videos</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground">
              Individual sets and clips, or unlock everything with the All-Access Pass.
            </p>
          </div>
          <AllAccessCard />
        </div>

        <div className="mt-10">
          <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
            <FilteredItemGrid />
          </Suspense>
        </div>
      </section>
    </>
  );
}

function AllAccessCard() {
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
  // Rank tiers so we can label other cards as Upgrade / Downgrade relative
  // to the user's current plan. Lifetime is the top rank.
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
        <ul className="mt-2 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5">
          {passes.map((p) => {
            const owned = tiers.active[p.plan];
            // Lifetime supersedes everything else; disable lower tiers.
            const supersededByLifetime = hasLifetime && p.plan !== "lifetime_onetime_aud";
            const disabled = owned || supersededByLifetime;
            const expiry = fmtExpiry(tiers.expires[p.plan]);
            const start = fmtExpiry(tiers.starts[p.plan]);
            const willCancel = !!tiers.cancelAtPeriodEnd[p.plan];
            const isLifetime = p.plan === "lifetime_onetime_aud";
            // Upgrade / Downgrade / Switch labels for non-owned cards when
            // the user already has a plan. Lifetime is always an upgrade.
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
                        <span
                          className="inline-flex items-center gap-1 text-[10px] text-primary/90 cursor-help"
                        >
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
                {badge && (
                  <span className="text-[10px] text-primary/90">{badge}</span>
                )}
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
                onClick={() =>
                  track("boutique_tier_click", { ...trackPayload, action: "blocked" })
                }
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
              <li key={p.plan} className={isLifetime ? "" : ""}>
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
      <Link
        to="/private-room"
        className="group rounded-2xl border border-primary/50 bg-background/40 p-5 hover:border-primary hover:bg-primary/5"
      >
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Private Room</div>
        <div className="mt-1 font-display text-2xl font-bold">
          From A$150<span className="text-sm text-muted-foreground"> / 30 min</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">Book a 30-minute or 1-hour private session.</div>
      </Link>
      <Link
        to="/store/subscribe"
        hash="panty-drawer"
        onClick={() => track("panty_link_click", { location: "store_categories" })}
        className="group rounded-2xl border border-primary/50 bg-background/40 p-5 hover:border-primary hover:bg-primary/5"
      >
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">The Panty Drawer</div>
        <div className="mt-1 font-display text-2xl font-bold">
          From A$60<span className="text-sm text-muted-foreground"> / pair</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">Worn, sealed, shipped discreetly across Australia.</div>
      </Link>
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
        Opens the secure Stripe billing portal in a new tab.
      </div>
    </button>
  );
}


type StoreItem = Awaited<ReturnType<typeof listStoreItems>>[number];

function tokenize(input: string | null | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[,/&|]|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function FilteredItemGrid() {
  const { data } = useSuspenseQuery(storeQuery);
  const { sizes, colors, styles } = Route.useSearch();
  const navigate = useNavigate({ from: "/store" });
  const [mobileOpen, setMobileOpen] = useState(false);

  const { sizeOptions, colorOptions, styleOptions } = useMemo(() => {
    const sSet = new Set<string>();
    const cSet = new Set<string>();
    const stSet = new Set<string>();
    for (const it of data as StoreItem[]) {
      ((it.sizes ?? []) as string[]).forEach((s: string) => s && sSet.add(s));
      tokenize(it.materials as string | null).forEach((c: string) => cSet.add(c));
      if (it.kind) stSet.add(it.kind);
    }
    const sortStr = (a: string, b: string) => a.localeCompare(b);
    return {
      sizeOptions: [...sSet].sort(sortStr),
      colorOptions: [...cSet].sort(sortStr),
      styleOptions: [...stSet].sort(sortStr),
    };
  }, [data]);

  const filtered = useMemo(() => {
    return (data as StoreItem[]).filter((item) => {
      if (styles.length && !styles.includes(item.kind)) return false;
      if (sizes.length) {
        const itemSizes = (item.sizes ?? []) as string[];
        if (!sizes.some((s: string) => itemSizes.includes(s))) return false;
      }
      if (colors.length) {
        const tokens = tokenize(item.materials as string | null).map((t) => t.toLowerCase());
        if (!colors.some((c: string) => tokens.includes(c.toLowerCase()))) return false;
      }
      return true;
    });
  }, [data, sizes, colors, styles]);

  const toggle = (group: "sizes" | "colors" | "styles", value: string) => {
    navigate({
      search: (prev: z.infer<typeof storeSearchSchema>) => {
        const current = (prev[group] ?? []) as string[];
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        return { ...prev, [group]: next };
      },
    });
  };

  const clearAll = () => navigate({ search: { sizes: [], colors: [], styles: [] } });

  const activeCount = sizes.length + colors.length + styles.length;

  if (!data.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-16 text-center">
        <p className="font-display text-lg">The shelves are empty tonight.</p>
        <p className="mt-2 text-sm text-muted-foreground">New drops coming soon.</p>
      </div>
    );
  }

  const sidebar = (
    <aside className="w-full md:w-64 md:shrink-0 rounded-2xl border border-border/60 bg-card/60 p-5 md:sticky md:top-24 md:self-start">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Filters</div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-muted-foreground hover:text-primary"
          >
            Clear all
          </button>
        )}
      </div>

      <FilterGroup
        label="Style"
        options={styleOptions}
        selected={styles}
        onToggle={(v) => toggle("styles", v)}
        renderLabel={labelForKind}
      />
      <FilterGroup
        label="Size"
        options={sizeOptions}
        selected={sizes}
        onToggle={(v) => toggle("sizes", v)}
      />
      <FilterGroup
        label="Color / Material"
        options={colorOptions}
        selected={colors}
        onToggle={(v) => toggle("colors", v)}
      />
    </aside>
  );

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <div className="hidden md:block">{sidebar}</div>

      <div className="flex-1 min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Showing {filtered.length} of {data.length}
            {activeCount > 0 ? ` · ${activeCount} filter${activeCount === 1 ? "" : "s"} active` : ""}
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs md:hidden"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
            <p className="font-display text-lg">No matches.</p>
            <p className="mt-2 text-sm text-muted-foreground">Try clearing some filters.</p>
            <button
              type="button"
              onClick={clearAll}
              className="mt-4 rounded-full border border-primary/60 px-4 py-1.5 text-xs uppercase tracking-widest text-primary hover:bg-primary/10"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => (
              <Link
                key={item.id}
                to="/store/$id"
                params={{ id: item.id }}
                className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition hover:border-primary/60"
              >
                <div className="relative aspect-[4/5] w-full overflow-hidden bg-secondary/30">
                  {item.cover_url ? (
                    <img
                      src={item.cover_url}
                      alt={item.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition group-hover:scale-105"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No cover</div>
                  )}
                  <div className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/90 backdrop-blur">
                    {labelForKind(item.kind)}
                  </div>
                  {item.subscribers_only && (
                    <div className="absolute right-2 top-2 rounded-full border border-primary/60 bg-primary/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary backdrop-blur">
                      Subs only
                    </div>
                  )}
                </div>
                <div className="p-4">
                  <div className="truncate font-medium">{item.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                    {item.description || "Tap for details."}
                  </div>
                  <div className="mt-3 flex items-center justify-between">
                    <div className="font-display text-lg text-neon">
                      {item.subscribers_only && !item.price_cents ? "Members" : item.price_cents ? formatPrice(item.price_cents) : "—"}
                    </div>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground group-hover:text-primary">
                      View →
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[85%] max-w-sm overflow-y-auto bg-background p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="font-display text-lg">Filters</div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close filters"
                className="rounded-full p-2 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4">{sidebar}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
  renderLabel,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  renderLabel?: (value: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mt-5">
      <div className="text-xs font-medium text-foreground/90">{label}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition",
                active
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/60 hover:text-foreground",
              )}
            >
              {renderLabel ? renderLabel(opt) : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}


function labelForKind(kind: string) {
  return kind === "photo_set" ? "Photos" : kind === "video" ? "Video" : "Bundle";
}
function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
