import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

export type MapPin = {
  id: string;
  title: string;
  description: string | null;
  latitude: number;
  longitude: number;
  sort_order: number;
};

function publicClient() {
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(process.env.SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

export const listMapPins = createServerFn({ method: "GET" }).handler(async (): Promise<MapPin[]> => {
  const supabase = publicClient();
  const { data, error } = await supabase
    .from("map_pins")
    .select("id, title, description, latitude, longitude, sort_order")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as MapPin[];
});

export const createMapPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { title: string; description?: string | null; latitude: number; longitude: number; sort_order?: number }) => {
    if (!data.title?.trim()) throw new Error("Title is required");
    if (typeof data.latitude !== "number" || data.latitude < -90 || data.latitude > 90) throw new Error("Invalid latitude");
    if (typeof data.longitude !== "number" || data.longitude < -180 || data.longitude > 180) throw new Error("Invalid longitude");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!role) throw new Error("Forbidden");
    const { data: row, error } = await context.supabase
      .from("map_pins")
      .insert({
        title: data.title.trim(),
        description: data.description?.trim() || null,
        latitude: data.latitude,
        longitude: data.longitude,
        sort_order: data.sort_order ?? 0,
        created_by: context.userId,
      })
      .select("id, title, description, latitude, longitude, sort_order")
      .single();
    if (error) throw new Error(error.message);
    return row as MapPin;
  });

export const updateMapPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; title: string; description?: string | null; latitude: number; longitude: number; sort_order?: number }) => data)
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!role) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("map_pins")
      .update({
        title: data.title.trim(),
        description: data.description?.trim() || null,
        latitude: data.latitude,
        longitude: data.longitude,
        sort_order: data.sort_order ?? 0,
      })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMapPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!role) throw new Error("Forbidden");
    const { error } = await context.supabase.from("map_pins").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const reorderMapPins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[] }) => {
    if (!Array.isArray(data.ids) || data.ids.some((id) => typeof id !== "string" || !id)) {
      throw new Error("ids must be a non-empty list of pin IDs");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!role) throw new Error("Forbidden");
    for (let i = 0; i < data.ids.length; i++) {
      const { error } = await context.supabase
        .from("map_pins")
        .update({ sort_order: i })
        .eq("id", data.ids[i]);
      if (error) throw new Error(error.message);
    }
    return { ok: true, count: data.ids.length };
  });
