import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";

export type PlanId =
  | "all_access_monthly_aud"
  | "all_access_3mo_monthly_aud"
  | "all_access_6mo_monthly_aud"
  | "all_access_12mo_monthly_aud"
  | "lifetime_onetime_aud";

/**
 * Recurring subscription lookup_keys. The monthly plan is the only
 * remaining recurring tier — 3/6/12-month passes are now one-time upfront
 * lump-sum payments that land as `memberships.kind = term_pass_{N}` rows.
 */
const SUBSCRIPTION_TIER_PRICE_IDS: readonly PlanId[] = [
  "all_access_monthly_aud",
];

/** Map term_pass_N kinds back to their PlanId. */
const TERM_PASS_KIND_TO_PLAN: Record<string, PlanId> = {
  term_pass_3: "all_access_3mo_monthly_aud",
  term_pass_6: "all_access_6mo_monthly_aud",
  term_pass_12: "all_access_12mo_monthly_aud",
};

export interface MyTiersState {
  loading: boolean;
  signedIn: boolean;
  active: Record<PlanId, boolean>;
  /** Expiry timestamps (ISO) for term/monthly if known. */
  expires: Partial<Record<PlanId, string | null>>;
  /** Start timestamps (ISO) for the current period / lifetime purchase. */
  starts: Partial<Record<PlanId, string | null>>;
  /** Whether the current subscription is set to cancel at period end. */
  cancelAtPeriodEnd: Partial<Record<PlanId, boolean>>;
}

const EMPTY_ACTIVE: Record<PlanId, boolean> = {
  all_access_monthly_aud: false,
  all_access_3mo_monthly_aud: false,
  all_access_6mo_monthly_aud: false,
  all_access_12mo_monthly_aud: false,
  lifetime_onetime_aud: false,
};

export function useMyTiers(): MyTiersState {
  const [state, setState] = useState<MyTiersState>({
    loading: true,
    signedIn: false,
    active: { ...EMPTY_ACTIVE },
    expires: {},
    starts: {},
    cancelAtPeriodEnd: {},
  });

  useEffect(() => {
    let cancelled = false;
    const env = getStripeEnvironment();

    async function load(userId: string | null) {
      if (!userId) {
        if (!cancelled)
          setState({
            loading: false,
            signedIn: false,
            active: { ...EMPTY_ACTIVE },
            expires: {},
            starts: {},
            cancelAtPeriodEnd: {},
          });
        return;
      }
      const [subsRes, memRes] = await Promise.all([
        supabase
          .from("subscriptions")
          .select("status,current_period_start,current_period_end,price_id,cancel_at_period_end,created_at")
          .eq("user_id", userId)
          .eq("environment", env)
          .in("price_id", SUBSCRIPTION_TIER_PRICE_IDS as unknown as string[])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("memberships")
          .select("kind,expires_at,created_at")
          .eq("user_id", userId)
          .eq("environment", env),
      ]);
      if (cancelled) return;
      const now = Date.now();
      const sub = subsRes.data;
      const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null;
      const subActive =
        !!sub &&
        (
          (["active", "trialing", "past_due"].includes(sub.status) && (!periodEnd || periodEnd > now)) ||
          (sub.status === "canceled" && !!periodEnd && periodEnd > now)
        );
      const activePlan = subActive
        ? (SUBSCRIPTION_TIER_PRICE_IDS.includes(sub!.price_id as PlanId)
            ? (sub!.price_id as PlanId)
            : null)
        : null;

      const mems = memRes.data ?? [];
      const lifetime = mems.find((r: any) => r.kind === "lifetime");

      // Pick the currently active term pass (latest non-expired row of each
      // kind). Term passes are one-time purchases, so `expires_at` is the
      // source of truth for "still active".
      const nowIso = new Date().toISOString();
      const activeTermPassByPlan: Partial<Record<PlanId, { starts: string | null; expires: string | null }>> = {};
      for (const row of mems) {
        const kind = String((row as any).kind ?? "");
        const plan = TERM_PASS_KIND_TO_PLAN[kind];
        if (!plan) continue;
        const expiresAt = (row as any).expires_at as string | null;
        if (!expiresAt || expiresAt <= nowIso) continue;
        const existing = activeTermPassByPlan[plan];
        // Prefer the latest-expiring row if user stacked purchases.
        if (!existing || (existing.expires ?? "") < expiresAt) {
          activeTermPassByPlan[plan] = {
            starts: ((row as any).created_at as string | null) ?? null,
            expires: expiresAt,
          };
        }
      }

      const subStart = (sub?.current_period_start ?? sub?.created_at) ?? null;
      const subEnd = sub?.current_period_end ?? null;
      const subCancel = !!sub?.cancel_at_period_end;
      const pick = <T,>(plan: PlanId, v: T): T | null => (activePlan === plan ? v : null);
      const termOr = <T,>(plan: PlanId, key: "starts" | "expires", fallback: T | null): T | null =>
        (activeTermPassByPlan[plan]?.[key] as T | undefined) ?? fallback;

      setState({
        loading: false,
        signedIn: true,
        active: {
          all_access_monthly_aud: activePlan === "all_access_monthly_aud",
          all_access_3mo_monthly_aud: !!activeTermPassByPlan.all_access_3mo_monthly_aud,
          all_access_6mo_monthly_aud: !!activeTermPassByPlan.all_access_6mo_monthly_aud,
          all_access_12mo_monthly_aud: !!activeTermPassByPlan.all_access_12mo_monthly_aud,
          lifetime_onetime_aud: !!lifetime,
        },
        expires: {
          all_access_monthly_aud: pick("all_access_monthly_aud", subEnd),
          all_access_3mo_monthly_aud: termOr("all_access_3mo_monthly_aud", "expires", null),
          all_access_6mo_monthly_aud: termOr("all_access_6mo_monthly_aud", "expires", null),
          all_access_12mo_monthly_aud: termOr("all_access_12mo_monthly_aud", "expires", null),
        },
        starts: {
          all_access_monthly_aud: pick("all_access_monthly_aud", subStart),
          all_access_3mo_monthly_aud: termOr("all_access_3mo_monthly_aud", "starts", null),
          all_access_6mo_monthly_aud: termOr("all_access_6mo_monthly_aud", "starts", null),
          all_access_12mo_monthly_aud: termOr("all_access_12mo_monthly_aud", "starts", null),
          lifetime_onetime_aud: lifetime?.created_at ?? null,
        },
        cancelAtPeriodEnd: {
          all_access_monthly_aud: activePlan === "all_access_monthly_aud" ? subCancel : false,
          // Term passes never auto-renew — no cancel-at-period-end concept.
          all_access_3mo_monthly_aud: false,
          all_access_6mo_monthly_aud: false,
          all_access_12mo_monthly_aud: false,
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
