import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getMyRewards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("referral_code, reward_points")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    return {
      referral_code: (data?.referral_code as string | null) ?? null,
      reward_points: (data?.reward_points as number | null) ?? 0,
    };
  });

export type RewardActivityItem = {
  id: string;
  created_at: string;
  delta: number;
  reason: string;
  detail: string | null;
  referral_code: string | null;
  kind: "referral" | "redemption" | "reservation";
  status: string | null;
};

export const getMyRewardActivity = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RewardActivityItem[]> => {
    const { supabase, userId } = context;

    const [grants, redemptions, reservations] = await Promise.all([
      supabase
        .from("referral_reward_grants")
        .select("id, created_at, points_awarded, referral_code, referred_user_id, referrer_user_id")
        .eq("referrer_user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("user_rewards")
        .select("id, created_at, points_spent, reward_name, status")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("reward_point_reservations")
        .select("id, created_at, points, status, order_id")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(100),
    ]);

    if (grants.error) throw grants.error;
    if (redemptions.error) throw redemptions.error;
    if (reservations.error) throw reservations.error;

    const items: RewardActivityItem[] = [
      ...(grants.data ?? []).map((g): RewardActivityItem => ({
        id: `grant:${g.id}`,
        created_at: g.created_at as string,
        delta: g.points_awarded ?? 0,
        reason: "Referred signup",
        detail: "A friend signed up with your referral code",
        referral_code: (g.referral_code as string | null) ?? null,
        kind: "referral",
        status: null,
      })),
      ...(redemptions.data ?? []).map((r): RewardActivityItem => ({
        id: `redeem:${r.id}`,
        created_at: r.created_at as string,
        delta: -(r.points_spent ?? 0),
        reason: `Redeemed: ${r.reward_name ?? "reward"}`,
        detail: null,
        referral_code: null,
        kind: "redemption",
        status: (r.status as string | null) ?? null,
      })),
      ...(reservations.data ?? [])
        .filter((r) => r.status !== "released")
        .map((r): RewardActivityItem => ({
          id: `resv:${r.id}`,
          created_at: r.created_at as string,
          delta: -(r.points ?? 0),
          reason: r.status === "consumed" ? "Points spent at checkout" : "Points held for checkout",
          detail: r.order_id ? `Order ${r.order_id}` : null,
          referral_code: null,
          kind: "reservation",
          status: (r.status as string | null) ?? null,
        })),
    ];

    items.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return items.slice(0, 100);
  });
