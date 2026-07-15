import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Global Maintenance Mode
 * -----------------------
 * Single boolean stored on the site_settings singleton. When true, the
 * public site hides upcoming events, disables store purchases, and shows
 * a banner. Admins bypass every gate — both UI (via useMaintenance) and
 * server-side (via assertNotInMaintenance in payment/RSVP entry points).
 */

/** Public read — anyone may fetch the flag to render the banner and gate UI. */
export const getMaintenanceMode = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ active: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("maintenance_mode")
      .eq("id", "host")
      .maybeSingle();
    return { active: !!data?.maintenance_mode };
  },
);

/** Admin-only toggle. */
export const setMaintenanceMode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { active: boolean }) =>
    z.object({ active: z.boolean() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("site_settings")
      .update({ maintenance_mode: data.active })
      .eq("id", "host");
    if (error) throw error;
    return { ok: true, active: data.active };
  });

/**
 * Server-side guard for payment/RSVP entry points. Throws a user-friendly
 * error when maintenance is on, unless the caller is an admin. Import and
 * `await assertNotInMaintenance(context)` at the top of any server fn that
 * completes a booking or purchase.
 */
export async function assertNotInMaintenance(context: {
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown }> };
  userId: string;
}): Promise<void> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("site_settings")
    .select("maintenance_mode")
    .eq("id", "host")
    .maybeSingle();
  if (!data?.maintenance_mode) return;
  const { data: isAdmin } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (isAdmin) return;
  throw new Error(
    "We are currently closed for private maintenance and upgrades. Check back soon.",
  );
}
