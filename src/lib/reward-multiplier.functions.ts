import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Global "points earned per A$1 spent" multiplier. Stored on the
 * site_settings singleton so admins can boost it during promotions
 * without a code change.
 */

export const getPointsPerDollarMultiplier = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ multiplier: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .select("points_per_dollar_multiplier" as any)
      .eq("id", "host")
      .maybeSingle();
    const raw = (data as { points_per_dollar_multiplier?: number | string | null } | null)
      ?.points_per_dollar_multiplier;
    const n = raw == null ? 1 : Number(raw);
    return { multiplier: Number.isFinite(n) && n >= 0 ? n : 1 };
  },
);

const schema = z.object({
  multiplier: z
    .number({ error: "Multiplier must be a number." })
    .min(0, "Multiplier must be zero or greater.")
    .max(1000, "Multiplier must be 1000 or less."),
});

export const setPointsPerDollarMultiplier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof schema>) => schema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("site_settings")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ points_per_dollar_multiplier: data.multiplier } as any)
      .eq("id", "host");
    if (error) throw error;
    return { ok: true, multiplier: data.multiplier };
  });
