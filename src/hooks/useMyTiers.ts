import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";

export type PlanId =
  | "all_access_monthly_aud"
  | "all_access_3mo_onetime_aud"
  | "all_access_6mo_onetime_aud"
  | "all_access_12mo_onetime_aud"
  | "lifetime_onetime_aud";

export interface MyTiersState {
  loading: boolean;
  signedIn: boolean;
  active: Record<PlanId, boolean>;
  /** Expiry timestamps (ISO) for term/monthly if known. */
  expires: Partial<Record<PlanId, string | null>>;
}

const EMPTY_ACTIVE: Record<PlanId, boolean> = {
  all_access_monthly_aud: false,
  all_access_3mo_onetime_aud: false,
  all_access_6mo_onetime_aud: false,
  all_access_12mo_onetime_aud: false,
  lifetime_onetime_aud: false,
};

export function useMyTiers(): MyTiersState {
  const [state, setState] = useState<MyTiersState>({
    loading: true,
    signedIn: false,
    active: { ...EMPTY_ACTIVE },
    expires: {},
  });

  useEffect(() => {
    let cancelled = false;
    const env = getStripeEnvironment();

    async function load(userId: string | null) {
      if (!userId) {
        if (!cancelled)
          setState({ loading: false, signedIn: false, active: { ...EMPTY_ACTIVE }, expires: {} });
        return;
      }
      const [subsRes, memRes] = await Promise.all([
        supabase
          .from("subscriptions")
          .select("status,current_period_end")
          .eq("user_id", userId)
          .eq("environment", env)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("memberships")
          .select("kind,expires_at")
          .eq("user_id", userId)
          .eq("environment", env),
      ]);
      if (cancelled) return;
      const now = Date.now();
      const sub = subsRes.data;
      const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null;
      const monthlyActive =
        !!sub &&
        (
          (["active", "trialing", "past_due"].includes(sub.status) && (!periodEnd || periodEnd > now)) ||
          (sub.status === "canceled" && !!periodEnd && periodEnd > now)
        );

      const mems = memRes.data ?? [];
      const activeTerm = (m: number) =>
        mems.find(
          (r: any) =>
            r.kind === `term_pass_${m}` && r.expires_at && new Date(r.expires_at).getTime() > now,
        );
      const t3 = activeTerm(3);
      const t6 = activeTerm(6);
      const t12 = activeTerm(12);
      const lifetime = mems.find((r: any) => r.kind === "lifetime");

      setState({
        loading: false,
        signedIn: true,
        active: {
          all_access_monthly_aud: monthlyActive,
          all_access_3mo_onetime_aud: !!t3,
          all_access_6mo_onetime_aud: !!t6,
          all_access_12mo_onetime_aud: !!t12,
          lifetime_onetime_aud: !!lifetime,
        },
        expires: {
          all_access_monthly_aud: sub?.current_period_end ?? null,
          all_access_3mo_onetime_aud: t3?.expires_at ?? null,
          all_access_6mo_onetime_aud: t6?.expires_at ?? null,
          all_access_12mo_onetime_aud: t12?.expires_at ?? null,
        },
      });
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;

    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      load(uid);
      if (uid) {
        channel = supabase
          .channel(`my-tiers-${uid}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "subscriptions", filter: `user_id=eq.${uid}` }, () => load(uid))
          .on("postgres_changes", { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${uid}` }, () => load(uid))
          .subscribe();
      }
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        load(session?.user?.id ?? null);
      }
    });

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      authSub.subscription.unsubscribe();
    };
  }, []);

  return state;
}
