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
      .select(
        "id, title, tagline, description, venue_name, city, address, starts_at, ends_at, dress_code, theme, cover_image_url, ticket_price_cents, waiver_text, capacity, is_private, published, host_id",
      )
      .eq("id", data.id)
      .eq("published", true)
      .eq("is_private", false)
      .maybeSingle();
    if (error) throw error;
    return row;
  });

