import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getMyMembership } from "@/lib/memberships.functions";

/**
 * Small card for the dashboard that surfaces whether the user still has
 * an unredeemed "free event entry" perk (attached to a 12-month term
 * pass or the Lifetime membership). Hidden entirely for users without an
 * eligible tier so lower-tier subscribers don't see empty state.
 */
export function PerksWidget() {
  const fetchMembership = useServerFn(getMyMembership);
  const q = useQuery({
    queryKey: ["my-membership-perks"],
    queryFn: () => fetchMembership(),
  });

  if (q.isLoading) {
    return (
      <div className="rounded-xl border border-border/60 bg-card p-4 text-xs text-muted-foreground">
        Checking your perks…
      </div>
    );
  }

  const m = q.data?.membership ?? null;
  if (!m) {
    // No eligible tier — render nothing so this widget doesn't nag users
    // on lower plans.
    return null;
  }

  const ticketUsed = Boolean(m.event_ticket_used_at);
  const tierLabel = m.kind === "lifetime" ? "Lifetime" : "12-Month Term";
  const expiresAt = m.expires_at ? new Date(m.expires_at) : null;

  return (
    <div className="rounded-xl border border-primary/40 bg-primary/5 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
          Your perks
        </div>
        <span className="rounded-full border border-primary/50 bg-primary/15 px-2 py-0.5 text-[9px] uppercase tracking-widest text-primary">
          {tierLabel}
        </span>
      </div>

      <ul className="mt-3 space-y-2 text-sm">
        <li className="flex items-start gap-2">
          <span
            aria-hidden="true"
            className={
              ticketUsed
                ? "mt-0.5 inline-block h-2 w-2 rounded-full bg-muted-foreground"
                : "mt-0.5 inline-block h-2 w-2 rounded-full bg-primary shadow-[var(--shadow-glow-pink)]"
            }
          />
          <div className="min-w-0 flex-1">
            <div className="font-medium">
              {ticketUsed
                ? "Free event entry — used"
                : "Active Free Event Entry"}
            </div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {ticketUsed
                ? "You've redeemed your free ticket. Additional events are still bookable at the standard price."
                : "Redeem it against any ticketed event at RSVP time."}
              {m.kind === "term_pass_12" && expiresAt && (
                <>
                  {" · Expires "}
                  {expiresAt.toLocaleDateString(undefined, {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </>
              )}
            </div>
          </div>
        </li>

        {m.kind === "lifetime" && (
          <li className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className={
                m.private_session_requested_at
                  ? "mt-0.5 inline-block h-2 w-2 rounded-full bg-muted-foreground"
                  : "mt-0.5 inline-block h-2 w-2 rounded-full bg-primary shadow-[var(--shadow-glow-pink)]"
              }
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium">
                {m.private_session_requested_at
                  ? "Private 30-min session — requested"
                  : "Private 30-min session"}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {m.private_session_requested_at
                  ? "Your request is in — the host will reach out to schedule."
                  : "Included with Lifetime. Request from your account settings when you're ready."}
              </div>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
