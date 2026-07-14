import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SiteSettings = {
  email: string;
  fetlife_handle: string;
  reddit_handle: string;
  glory_holes_enabled: boolean;
};

const DEFAULTS: SiteSettings = {
  email: "midnight-glory@princesspink90.com",
  fetlife_handle: "pink_princess90",
  reddit_handle: "19pink-princess90",
  glory_holes_enabled: true,
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
      .select("email, fetlife_handle, reddit_handle, glory_holes_enabled")
      .eq("id", "host")
      .maybeSingle();
    return data ?? DEFAULTS;
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
      })
      .eq("id", "host");
    if (error) throw error;
    return { ok: true };
  });

