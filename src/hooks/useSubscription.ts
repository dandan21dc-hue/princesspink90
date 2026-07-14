import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";

/**
 * Subscription-like state derived from active memberships. After the Stripe
 * removal the only recurring product is the 30-day All-Access Pass, stored
 * as `memberships.kind = 'term_pass_all_access_30d'` with an `expires_at`.
 * The shape is intentionally the same as before so consumers (banners,
 * gated UI) don't change.
 */
export interface SubscriptionState {
  loading: boolean;
  isActive: boolean;
  isPastDue: boolean;
  /** True when a lifetime or valid term-pass membership grants access. */
  hasMembership: boolean;
  subscription: {
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean | null;
  } | null;
}

export function useSubscription(userId: string | null | undefined): SubscriptionState {
  const [state, setState] = useState<SubscriptionState>({
    loading: true,
    isActive: false,
    isPastDue: false,
    hasMembership: false,
    subscription: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setState({ loading: false, isActive: false, isPastDue: false, hasMembership: false, subscription: null });
      return;
    }
    const env = getStripeEnvironment();

    async function fetchIt() {
      const memRes = await supabase
        .from("memberships")
        .select("kind,expires_at")
        .eq("user_id", userId!)
        .eq("environment", env);
      if (cancelled) return;
      const now = Date.now();
      const rows = memRes.data ?? [];
      const hasMembership = rows.some((m) =>
        m.kind === "lifetime"
        || (String(m.kind).startsWith("term_pass_") && m.expires_at && new Date(m.expires_at).getTime() > now),
      );
      const latestTermPass = rows
        .filter((m) => String(m.kind).startsWith("term_pass_") && m.expires_at)
        .sort((a, b) => (b.expires_at! > a.expires_at! ? 1 : -1))[0];
      setState({
        loading: false,
        isActive: hasMembership,
        isPastDue: false,
        hasMembership,
        subscription: latestTermPass
          ? {
              status: hasMembership ? "active" : "canceled",
              current_period_end: latestTermPass.expires_at ?? null,
              cancel_at_period_end: true,
            }
          : null,
      });
    }
    fetchIt();

    const subChannel = supabase
      .channel(`sub-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${userId}` }, () => fetchIt())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(subChannel);
    };
  }, [userId]);

  return state;
}
