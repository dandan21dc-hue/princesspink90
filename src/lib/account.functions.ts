import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type StripeEnv = "sandbox" | "live";

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
  .handler(async ({ context }): Promise<{ ok: true } | { error: string }> => {
    const purgeAt = new Date(Date.now() + GRACE_DAYS * 24 * 60 * 60 * 1000);
    const { error } = await context.supabase
      .from("profiles")
      .update({ pending_deletion_at: purgeAt.toISOString() } as any)
      .eq("user_id", context.userId);
    if (error) return { error: error.message };
    return { ok: true };
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

export const confirmAgeGate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true } | { error: string }> => {
    const { error } = await context.supabase
      .from("profiles")
      .update({ age_gate_confirmed_at: new Date().toISOString() } as any)
      .eq("user_id", context.userId);
    if (error) return { error: error.message };
    return { ok: true };
  });

export const checkAgeGate = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ confirmed: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.rpc("has_age_verification", {
      _user_id: context.userId,
    });
    return { confirmed: !!data };
  });
