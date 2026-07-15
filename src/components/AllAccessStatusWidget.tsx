import { Link } from "@tanstack/react-router";
import { useMyTiers, type PlanId } from "@/hooks/useMyTiers";

/**
 * Dashboard widget summarising the viewer's active All-Access passes and when
 * each expires. Lifetime members see a "never expires" line; users with no
 * active pass see a prompt to browse the tiers.
 */
const PLAN_LABEL: Record<PlanId, string> = {
  all_access_30d_aud: "30-Day Pass",
  all_access_90d_aud: "3-Month Pass",
  all_access_180d_aud: "6-Month Pass",
  all_access_365d_aud: "12-Month Pass",
  lifetime_onetime_aud: "Lifetime",
};

const ORDER: PlanId[] = [
  "lifetime_onetime_aud",
  "all_access_365d_aud",
  "all_access_180d_aud",
  "all_access_90d_aud",
  "all_access_30d_aud",
];

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function daysLeft(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}

export function AllAccessStatusWidget() {
  const tiers = useMyTiers();

  if (tiers.loading || !tiers.signedIn) return null;

  const active = ORDER.filter((p) => tiers.active[p]);

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
          All-Access status
        </div>
        <Link
          to="/all-access-pass"
          className="text-[10px] font-semibold uppercase tracking-widest text-primary hover:underline"
        >
          Manage
        </Link>
      </div>

      {active.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No active All-Access pass.{" "}
          <Link to="/all-access-pass" className="text-primary hover:underline">
            Browse tiers
          </Link>
          .
        </p>
      ) : (
        <ul className="mt-3 space-y-2 text-sm">
          {active.map((plan) => {
            const isLifetime = plan === "lifetime_onetime_aud";
            const expiresAt = tiers.expires[plan] ?? null;
            const startsAt = tiers.starts[plan] ?? null;
            return (
              <li key={plan} className="flex items-start gap-2">
                <span
                  aria-hidden="true"
                  className="mt-1.5 inline-block h-2 w-2 rounded-full bg-primary shadow-[var(--shadow-glow-pink)]"
                />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{PLAN_LABEL[plan]}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {isLifetime ? (
                      <>
                        {startsAt ? `Started ${fmt(startsAt)} · ` : ""}
                        Never expires
                      </>
                    ) : expiresAt ? (
                      <>
                        Expires {fmt(expiresAt)} ·{" "}
                        <span className="text-primary">
                          {daysLeft(expiresAt)} day
                          {daysLeft(expiresAt) === 1 ? "" : "s"} left
                        </span>
                      </>
                    ) : (
                      "Active"
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
