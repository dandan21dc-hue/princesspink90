import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const env = () => (process.env.NODE_ENV === "production" ? "live" : "sandbox");

export type StoreEntitlements = {
  monthlyActive: boolean;
  term3Active: boolean;
  term6Active: boolean;
  term12Active: boolean;
  lifetime: boolean;
};

export const getMyStoreEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoreEntitlements> => {
    const { supabase, userId } = context;
    const e = env();

    const [subsRes, memRes] = await Promise.all([
      supabase
        .from("subscriptions")
        .select("status, current_period_end, price_id")
        .eq("user_id", userId)
        .eq("environment", e)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("memberships")
        .select("kind, expires_at")
        .eq("user_id", userId)
        .eq("environment", e),
    ]);

    const sub = subsRes.data?.[0];
    const now = Date.now();
    const monthlyActive =
      !!sub &&
      (["active", "trialing", "past_due"].includes(sub.status) ||
        (sub.status === "canceled" &&
          !!sub.current_period_end &&
          new Date(sub.current_period_end).getTime() > now)) &&
      (!sub.current_period_end || new Date(sub.current_period_end).getTime() > now);

    const mems = memRes.data ?? [];
    const activeTerm = (months: number) =>
      mems.some(
        (m: any) =>
          m.kind === `term_pass_${months}` &&
          m.expires_at &&
          new Date(m.expires_at).getTime() > now,
      );

    return {
      monthlyActive,
      term3Active: activeTerm(3),
      term6Active: activeTerm(6),
      term12Active: activeTerm(12),
      lifetime: mems.some((m: any) => m.kind === "lifetime"),
    };
  });
