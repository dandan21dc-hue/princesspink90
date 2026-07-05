import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

function publicClient() {
  return createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { storage: undefined, persistSession: false, autoRefreshToken: false } },
  );
}

export const listPublicEvents = createServerFn({ method: "GET" }).handler(async () => {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, title, tagline, venue_name, city, starts_at, cover_image_url, dress_code, theme, is_private, published",
    )
    .eq("published", true)
    .eq("is_private", false)
    .gte("starts_at", new Date(Date.now() - 6 * 3600 * 1000).toISOString())
    .order("starts_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  return data ?? [];
});

export const getPublicEventById = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const supabase = publicClient();
    const { data: row, error } = await supabase
      .from("events")
      .select("*")
      .eq("id", data.id)
      .eq("published", true)
      .eq("is_private", false)
      .maybeSingle();
    if (error) throw error;
    return row;
  });

export const unlockEventByCode = createServerFn({ method: "POST" })
  .inputValidator((data: { code: string }) =>
    z.object({ code: z.string().trim().min(3).max(64) }).parse(data),
  )
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: accessRow, error } = await supabaseAdmin
      .from("event_access_codes")
      .select("event_id, events(*)")
      .eq("code", data.code)
      .maybeSingle();
    if (error) throw error;
    if (!accessRow || !accessRow.events) return { ok: false as const };
    // Only return if event is still published
    if (!accessRow.events.published) return { ok: false as const };
    return { ok: true as const, event: accessRow.events };
  });
