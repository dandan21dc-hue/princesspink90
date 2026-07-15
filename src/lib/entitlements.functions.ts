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

/**
 * All All-Access entitlements now live in `public.memberships`. The legacy
 * `subscriptions` table was dropped with Stripe, so this reads memberships
 * only:
 *
 *   term_pass_all_access_30d → monthlyActive (30-day pass)
 *   term_pass_3 / 6 / 12    → term{3,6,12}Active
 *   lifetime                → lifetime
 */
export const getMyStoreEntitlements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<StoreEntitlements> => {
    const { supabase, userId } = context;
    const e = env();

    const { data } = await supabase
      .from("memberships")
      .select("kind, expires_at")
      .eq("user_id", userId)
      .eq("environment", e);

    const mems = data ?? [];
    const now = Date.now();
    const activeKind = (kind: string) =>
      mems.some(
        (m: any) =>
          m.kind === kind &&
          m.expires_at &&
          new Date(m.expires_at).getTime() > now,
      );

    return {
      monthlyActive: activeKind("term_pass_all_access_30d"),
      term3Active: activeKind("term_pass_3"),
      term6Active: activeKind("term_pass_6"),
      term12Active: activeKind("term_pass_12"),
      lifetime: mems.some((m: any) => m.kind === "lifetime"),
    };
  });
