import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";

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
      const [subRes, memRes] = await Promise.all([
        supabase
          .from("subscriptions")
          .select("status,current_period_end,cancel_at_period_end")
          .eq("user_id", userId!)
          .eq("environment", env)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("memberships")
          .select("kind,expires_at")
          .eq("user_id", userId!)
          .eq("environment", env)
          .or("kind.eq.lifetime,kind.like.term_pass_%"),
      ]);
      if (cancelled) return;
      const data = subRes.data;
      const now = Date.now();
      const periodEnd = data?.current_period_end ? new Date(data.current_period_end).getTime() : null;
      const subActive = !!data && (
        (["active", "trialing", "past_due"].includes(data.status) && (!periodEnd || periodEnd > now))
        || (data.status === "canceled" && !!periodEnd && periodEnd > now)
      );
      const hasMembership = (memRes.data ?? []).some((m: any) =>
        m.kind === "lifetime"
        || (String(m.kind).startsWith("term_pass_") && m.expires_at && new Date(m.expires_at).getTime() > now)
      );
      const isPastDue = data?.status === "past_due";
      setState({
        loading: false,
        isActive: subActive || hasMembership,
        isPastDue,
        hasMembership,
        subscription: data ?? null,
      });
    }
    fetchIt();

    const subChannel = supabase
      .channel(`sub-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` }, () => fetchIt())
      .on("postgres_changes", { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${userId}` }, () => fetchIt())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(subChannel);
    };
  }, [userId]);

  return state;
}
