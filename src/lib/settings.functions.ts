import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type SiteSettings = {
  email: string;
  fetlife_handle: string;
  reddit_handle: string;
};

const DEFAULTS: SiteSettings = {
  email: "princesspink9014@gmail.com",
  fetlife_handle: "pink_princess90",
  reddit_handle: "19pink-princess90",
};

export const getSiteSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<SiteSettings> => {
    const sb = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
    );
    const { data } = await sb
      .from("site_settings")
      .select("email, fetlife_handle, reddit_handle")
      .eq("id", "host")
      .maybeSingle();
    return data ?? DEFAULTS;
  },
);

const updateSchema = z.object({
  email: z.string().trim().email().max(255),
  fetlife_handle: z.string().trim().min(1).max(100),
  reddit_handle: z.string().trim().min(1).max(100),
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
      })
      .eq("id", "host");
    if (error) throw error;
    return { ok: true };
  });
