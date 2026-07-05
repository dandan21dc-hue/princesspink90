import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";

export interface SubscriptionState {
  loading: boolean;
  isActive: boolean;
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
    subscription: null,
  });

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setState({ loading: false, isActive: false, subscription: null });
      return;
    }
    const env = getStripeEnvironment();

    async function fetchIt() {
      const { data } = await supabase
        .from("subscriptions")
        .select("status,current_period_end,cancel_at_period_end")
        .eq("user_id", userId!)
        .eq("environment", env)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const now = Date.now();
      const periodEnd = data?.current_period_end ? new Date(data.current_period_end).getTime() : null;
      const isActive = !!data && (
        (["active", "trialing", "past_due"].includes(data.status) && (!periodEnd || periodEnd > now))
        || (data.status === "canceled" && !!periodEnd && periodEnd > now)
      );
      setState({ loading: false, isActive, subscription: data ?? null });
    }
    fetchIt();

    const channel = supabase
      .channel(`sub-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${userId}` }, () => fetchIt())
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return state;
}
