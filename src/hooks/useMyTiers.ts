import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getStripeEnvironment } from "@/lib/stripe";

/**
 * All-Access Pass ownership derived exclusively from `public.memberships`.
 * Every tier is a NOWPayments one-time purchase — there are no recurring
 * subscriptions or Stripe fallbacks.
 *
 *   term_pass_all_access_30d → 30-day pass  (`all_access_30d_aud`)
 *   lifetime                 → lifetime pass (`lifetime_onetime_aud`)
 */
export type PlanId = "all_access_30d_aud" | "lifetime_onetime_aud";

export interface MyTiersState {
  loading: boolean;
  signedIn: boolean;
  active: Record<PlanId, boolean>;
  /** Expiry timestamp (ISO) for the 30-day pass if known. */
  expires: Partial<Record<PlanId, string | null>>;
  /** Start timestamp (ISO) for the current pass / lifetime purchase. */
  starts: Partial<Record<PlanId, string | null>>;
  /**
   * Whether the current pass is set to cancel at period end. Kept for API
   * compatibility; NOWPayments passes never auto-renew, so this is always false.
   */
  cancelAtPeriodEnd: Partial<Record<PlanId, boolean>>;
  /** Force a refetch from the client (e.g. on focus, or after checkout). */
  refresh: () => void;
}

type TiersData = Omit<MyTiersState, "refresh">;

const EMPTY_ACTIVE: Record<PlanId, boolean> = {
  all_access_30d_aud: false,
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

      // Pick the currently active 30-day pass (latest non-expired row).
      // Passes are one-time NOWPayments purchases so `expires_at` is the
      // source of truth for "still active".
      let active30d: { starts: string | null; expires: string | null } | null = null;
      for (const row of mems) {
        if (String((row as any).kind ?? "") !== "term_pass_all_access_30d") continue;
        const expiresAt = (row as any).expires_at as string | null;
        if (!expiresAt || expiresAt <= nowIso) continue;
        if (!active30d || (active30d.expires ?? "") < expiresAt) {
          active30d = {
            starts: ((row as any).created_at as string | null) ?? null,
            expires: expiresAt,
          };
        }
      }

      setState({
        loading: false,
        signedIn: true,
        active: {
          all_access_30d_aud: !!active30d,
          lifetime_onetime_aud: !!lifetime,
        },
        expires: {
          all_access_30d_aud: active30d?.expires ?? null,
        },
        starts: {
          all_access_30d_aud: active30d?.starts ?? null,
          lifetime_onetime_aud: lifetime?.created_at ?? null,
        },
        cancelAtPeriodEnd: {
          all_access_30d_aud: false,
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
