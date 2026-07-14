import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SiteSettings = {
  email: string;
  fetlife_handle: string;
  reddit_handle: string;
  glory_holes_enabled: boolean;
  session_price_cents: number;
  session_duration_minutes: number;
};

const DEFAULTS: SiteSettings = {
  email: "midnight-glory@princesspink90.com",
  fetlife_handle: "pink_princess90",
  reddit_handle: "19pink-princess90",
  glory_holes_enabled: true,
  session_price_cents: 27500,
  session_duration_minutes: 60,
};

export const getSiteSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteSettings> => {
    // Reads through supabaseAdmin because the site_settings SELECT policy
    // is restricted to authenticated users (host contact email is PII and
    // must not be exposed via the anon Data API). This server fn is the
    // sanctioned way to project the safe public contact info.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select(
        "email, fetlife_handle, reddit_handle, glory_holes_enabled, session_price_cents, session_duration_minutes",
      )
      .eq("id", "host")
      .maybeSingle();
    return data ?? DEFAULTS;
  },
);

/**
 * Public projection of the active session price and duration. Safe to expose
 * unauthenticated — pricing is public info displayed on the booking pages.
 */
export const getSessionPricing = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ price_cents: number; duration_minutes: number }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("session_price_cents, session_duration_minutes")
      .eq("id", "host")
      .maybeSingle();
    return {
      price_cents: data?.session_price_cents ?? DEFAULTS.session_price_cents,
      duration_minutes: data?.session_duration_minutes ?? DEFAULTS.session_duration_minutes,
    };
  },
);

/**
 * Public boolean-only projection of the Glory Holes toggle. Safe to expose
 * unauthenticated because it contains no PII — used by the public booking
 * page to hide itself when the admin has disabled it.
 */
export const getGloryHolesEnabled = createServerFn({ method: "GET" }).handler(
  async (): Promise<{ enabled: boolean }> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("glory_holes_enabled")
      .eq("id", "host")
      .maybeSingle();
    return { enabled: data?.glory_holes_enabled ?? true };
  },
);

const updateSchema = z.object({
  email: z.string().trim().email().max(255),
  fetlife_handle: z.string().trim().min(1).max(100),
  reddit_handle: z.string().trim().min(1).max(100),
  glory_holes_enabled: z.boolean(),
  session_price_cents: z.number().int().positive().max(10_000_00),
  session_duration_minutes: z.number().int().positive().max(480),
});

export const updateSiteSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: SiteSettings) => updateSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("site_settings")
      .update({
        email: data.email,
        fetlife_handle: data.fetlife_handle,
        reddit_handle: data.reddit_handle,
        glory_holes_enabled: data.glory_holes_enabled,
        session_price_cents: data.session_price_cents,
        session_duration_minutes: data.session_duration_minutes,
      })
      .eq("id", "host");
    if (error) throw error;
    return { ok: true };
  });

