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
