import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";

/** Days between requesting deletion and the actual purge. */
const GRACE_DAYS = 30;

export const getAccountStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase
      .from("profiles")
      .select("pending_deletion_at,deleted_at,display_name")
      .eq("user_id", context.userId)
      .maybeSingle();
    return {
      pending_deletion_at: (data as any)?.pending_deletion_at ?? null,
      deleted_at: (data as any)?.deleted_at ?? null,
      display_name: data?.display_name ?? null,
    };
  });

export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ ok: true } | { error: string }> => {
    try {
      const purgeAt = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
      const { error } = await context.supabase
        .from("profiles")
        .update({ pending_deletion_at: purgeAt.toISOString() } as any)
        .eq("user_id", context.userId);
      if (error) throw new Error(error.message);

      // Cancel any active subscription at period end so we're not billing a
      // user who's on their way out. Best-effort — deletion still proceeds
      // even if Stripe is temporarily unreachable.
      try {
        const { data: sub } = await context.supabase
          .from("subscriptions")
          .select("stripe_subscription_id")
          .eq("user_id", context.userId)
          .eq("environment", data.environment)
          .in("status", ["active", "trialing", "past_due"])
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (sub?.stripe_subscription_id) {
          const stripe = createStripeClient(data.environment);
          await stripe.subscriptions.update(sub.stripe_subscription_id, {
            cancel_at_period_end: true,
          });
        }
      } catch (err) {
        console.warn("requestAccountDeletion: subscription cancel failed:", err);
      }

      return { ok: true };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const cancelAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true } | { error: string }> => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ pending_deletion_at: null } as any)
      .eq("user_id", context.userId);
    if (error) return { error: error.message };
    return { ok: true };
  });
