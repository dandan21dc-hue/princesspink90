import { createFileRoute, Link } from "@tanstack/react-router";
import { Sparkles, Infinity as InfinityIcon, Calendar, ArrowRight } from "lucide-react";
import { useMyTiers, type PlanId } from "@/hooks/useMyTiers";

export const Route = createFileRoute("/_authenticated/account/billing")({
  head: () => ({
    meta: [
      { title: "Billing & Access — Midnight Glory" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BillingPage,
});

type TierMeta = {
  plan: PlanId;
  label: string;
  blurb: string;
  Icon: typeof Sparkles;
};

const TERM_TIERS: TierMeta[] = [
  {
    plan: "all_access_30d_aud",
    label: "30-Day All-Access Pass",
    blurb: "30 days of unlimited streaming — one-time crypto payment.",
    Icon: Calendar,
  },
];

const LIFETIME_TIER: TierMeta = {
  plan: "lifetime_onetime_aud",
  label: "Lifetime Membership",
  blurb: "Forever access. No expiry, no renewals.",
  Icon: InfinityIcon,
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

function BillingPage() {
  const tiers = useMyTiers();

  if (tiers.loading) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-10">
        <h1 className="font-display text-3xl font-bold">Billing &amp; Access</h1>
        <p className="mt-6 text-sm text-muted-foreground">Loading your access…</p>
      </div>
    );
  }

  const activeTerms = TERM_TIERS.filter((t) => tiers.active[t.plan]);
  const lifetime = tiers.active.lifetime_onetime_aud;
  const hasAnyActive = lifetime || activeTerms.length > 0;

  return (
    <div className="mx-auto max-w-3xl px-5 py-10">
      <header>
        <h1 className="font-display text-3xl font-bold">Billing &amp; Access</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Every purchase on Midnight Glory is a one-time crypto payment via NOWPayments —
          nothing auto-renews. This page shows the passes currently attached to your account.
        </p>
      </header>

      {!hasAnyActive ? (
        <EmptyState />
      ) : (
        <section className="mt-8 space-y-4">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary">
            Active entitlements
          </h2>

          {lifetime && (
            <TierRow
              tier={LIFETIME_TIER}
              badge="Lifetime"
              primary="Never expires"
              secondary={`Purchased ${formatDate(tiers.starts.lifetime_onetime_aud ?? null)}`}
            />
          )}

          {activeTerms.map((t) => {
            const expires = tiers.expires[t.plan] ?? null;
            const days = daysUntil(expires);
            return (
              <TierRow
                key={t.plan}
                tier={t}
                badge={days !== null ? `${days} day${days === 1 ? "" : "s"} left` : "Active"}
                primary={expires ? `Expires ${formatDate(expires)}` : "Active"}
                secondary={`Started ${formatDate(tiers.starts[t.plan] ?? null)}`}
              />
            );
          })}

          <p className="pt-2 text-xs text-muted-foreground">
            Term passes end automatically when they expire. To keep access, purchase a new
            pass before the current one lapses.
          </p>
        </section>
      )}

      <section className="mt-10 rounded-2xl border border-border/60 bg-card/60 p-5">
        <h2 className="font-display text-lg font-semibold">Receipts &amp; refunds</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Hosted invoices aren't issued for crypto payments — your NOWPayments confirmation
          email is your receipt. For refund or billing questions, contact{" "}
          <a
            className="text-primary underline underline-offset-2"
            href="mailto:support@midnightglory.au?subject=Billing%20question"
          >
            support@midnightglory.au
          </a>
          .
        </p>
      </section>
    </div>
  );
}

function EmptyState() {
  return (
    <section className="mt-8 rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Sparkles className="h-6 w-6" aria-hidden />
      </div>
      <h2 className="mt-4 font-display text-xl font-semibold">No active passes yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
        You don't have an All-Access Pass or Lifetime Membership on your account. Pick a pass
        to unlock the full library, private-room bookings, and member perks.
      </p>
      <Link
        to="/all-access-pass"
        className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
      >
        Browse passes
        <ArrowRight className="h-3.5 w-3.5" aria-hidden />
      </Link>
    </section>
  );
}

function TierRow({
  tier,
  badge,
  primary,
  secondary,
}: {
  tier: TierMeta;
  badge: string;
  primary: string;
  secondary: string;
}) {
  const { Icon } = tier;
  return (
    <div className="flex items-start justify-between gap-4 rounded-2xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex min-w-0 gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Icon className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="font-display text-base font-semibold">{tier.label}</div>
          <div className="text-xs text-muted-foreground">{tier.blurb}</div>
          <div className="mt-2 text-sm">{primary}</div>
          <div className="text-xs text-muted-foreground">{secondary}</div>
        </div>
      </div>
      <span className="shrink-0 rounded-full border border-primary/50 bg-primary/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-primary">
        {badge}
      </span>
    </div>
  );
}
