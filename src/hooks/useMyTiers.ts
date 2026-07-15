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
 * All All-Access tiers are now expressed as rows in `public.memberships`.
 * The legacy `subscriptions` table was dropped with Stripe, so this hook
 * derives everything from memberships kinds/expires_at.
 *
 *   term_pass_all_access_30d → monthly (30-day) pass
 *   term_pass_3 / 6 / 12    → multi-month term passes
 *   lifetime                → lifetime pass (no expiry)
 */
const TERM_PASS_KIND_TO_PLAN: Record<string, PlanId> = {
  term_pass_all_access_30d: "all_access_monthly_aud",
  term_pass_3: "all_access_3mo_monthly_aud",
  term_pass_6: "all_access_6mo_monthly_aud",
  term_pass_12: "all_access_12mo_monthly_aud",
};

export interface MyTiersState {
  loading: boolean;
  signedIn: boolean;
  active: Record<PlanId, boolean>;
  /** Expiry timestamps (ISO) for term passes if known. */
  expires: Partial<Record<PlanId, string | null>>;
  /** Start timestamps (ISO) for the current period / lifetime purchase. */
  starts: Partial<Record<PlanId, string | null>>;
  /**
   * Whether the current subscription is set to cancel at period end. Kept for
   * API compatibility; term passes never auto-renew, so this is always false.
   */
  cancelAtPeriodEnd: Partial<Record<PlanId, boolean>>;
  /** Force a refetch from the client (e.g. on focus, or after checkout). */
  refresh: () => void;
}

type TiersData = Omit<MyTiersState, "refresh">;

const EMPTY_ACTIVE: Record<PlanId, boolean> = {
  all_access_monthly_aud: false,
  all_access_3mo_monthly_aud: false,
  all_access_6mo_monthly_aud: false,
  all_access_12mo_monthly_aud: false,
  lifetime_onetime_aud: false,
};

export function useMyTiers(): MyTiersState {
  const [state, setState] = useState<TiersData>({
    loading: true,
    signedIn: false,
    active: { ...EMPTY_ACTIVE },
    expires: {},
    starts: {},
    cancelAtPeriodEnd: {},
  });
  const loadRef = useRef<(() => void) | null>(null);

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

      const { data } = await supabase
        .from("memberships")
        .select("kind,expires_at,created_at")
        .eq("user_id", userId)
        .eq("environment", env);
      if (cancelled) return;

      const mems = data ?? [];
      const nowIso = new Date().toISOString();
      const lifetime = mems.find((r: any) => r.kind === "lifetime");

      // Pick the currently active term pass (latest non-expired row of each
      // kind). Term passes are one-time purchases, so `expires_at` is the
      // source of truth for "still active".
      const activeTermPassByPlan: Partial<
        Record<PlanId, { starts: string | null; expires: string | null }>
      > = {};
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

      const termOr = <T,>(plan: PlanId, key: "starts" | "expires", fallback: T | null): T | null =>
        (activeTermPassByPlan[plan]?.[key] as T | undefined) ?? fallback;

      setState({
        loading: false,
        signedIn: true,
        active: {
          all_access_monthly_aud: !!activeTermPassByPlan.all_access_monthly_aud,
          all_access_3mo_monthly_aud: !!activeTermPassByPlan.all_access_3mo_monthly_aud,
          all_access_6mo_monthly_aud: !!activeTermPassByPlan.all_access_6mo_monthly_aud,
          all_access_12mo_monthly_aud: !!activeTermPassByPlan.all_access_12mo_monthly_aud,
          lifetime_onetime_aud: !!lifetime,
        },
        expires: {
          all_access_monthly_aud: termOr("all_access_monthly_aud", "expires", null),
          all_access_3mo_monthly_aud: termOr("all_access_3mo_monthly_aud", "expires", null),
          all_access_6mo_monthly_aud: termOr("all_access_6mo_monthly_aud", "expires", null),
          all_access_12mo_monthly_aud: termOr("all_access_12mo_monthly_aud", "expires", null),
        },
        starts: {
          all_access_monthly_aud: termOr("all_access_monthly_aud", "starts", null),
          all_access_3mo_monthly_aud: termOr("all_access_3mo_monthly_aud", "starts", null),
          all_access_6mo_monthly_aud: termOr("all_access_6mo_monthly_aud", "starts", null),
          all_access_12mo_monthly_aud: termOr("all_access_12mo_monthly_aud", "starts", null),
          lifetime_onetime_aud: lifetime?.created_at ?? null,
        },
        cancelAtPeriodEnd: {
          // Nothing auto-renews anymore — every tier is a one-time purchase.
          all_access_monthly_aud: false,
          all_access_3mo_monthly_aud: false,
          all_access_6mo_monthly_aud: false,
          all_access_12mo_monthly_aud: false,
        },
      });
    }

    let channel: ReturnType<typeof supabase.channel> | null = null;
    let currentUid: string | null = null;

    const refresh = () => {
      void load(currentUid);
    };
    loadRef.current = refresh;

    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      currentUid = uid;
      load(uid);
      if (uid) {
        channel = supabase
          .channel(`my-tiers-${uid}`)
          .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "memberships", filter: `user_id=eq.${uid}` },
            () => load(uid),
          )
          .subscribe();
      }
    });

    const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        currentUid = session?.user?.id ?? null;
        load(currentUid);
      }
    });

    // Re-check tier state whenever the tab regains focus. This covers the
    // return-from-checkout case (user tabs back after paying) plus any time
    // realtime disconnects while the tab was hidden.
    const onFocus = () => {
      if (currentUid) load(currentUid);
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible" && currentUid) load(currentUid);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      authSub.subscription.unsubscribe();
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibility);
      loadRef.current = null;
    };
  }, []);

  const refresh = useCallback(() => {
    loadRef.current?.();
  }, []);

  return { ...state, refresh };
}
