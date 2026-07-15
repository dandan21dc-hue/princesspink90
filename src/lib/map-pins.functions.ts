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

async function geocodeAddress(address: string): Promise<{ latitude: number; longitude: number }> {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) throw new Error("MAPBOX_TOKEN is not configured");
  const q = encodeURIComponent(address.trim());
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${q}.json?limit=1&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Mapbox geocoding failed [${res.status}]: ${body}`);
  }
  const json = (await res.json()) as { features?: Array<{ center?: [number, number] }> };
  const center = json.features?.[0]?.center;
  if (!center || center.length !== 2) throw new Error(`No geocoding result for "${address}"`);
  const [longitude, latitude] = center;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new Error("Geocoder returned out-of-range coordinates");
  }
  return { latitude, longitude };
}

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
  .inputValidator((data: { title: string; description?: string | null; address?: string | null; latitude?: number; longitude?: number; sort_order?: number }) => {
    if (!data.title?.trim()) throw new Error("Title is required");
    const hasCoords = typeof data.latitude === "number" && typeof data.longitude === "number";
    const hasAddress = typeof data.address === "string" && data.address.trim().length > 0;
    if (!hasCoords && !hasAddress) throw new Error("Provide either an address or latitude/longitude");
    if (hasCoords) {
      if (data.latitude! < -90 || data.latitude! > 90) throw new Error("Invalid latitude");
      if (data.longitude! < -180 || data.longitude! > 180) throw new Error("Invalid longitude");
    }
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: role } = await context.supabase.rpc("has_role", { _user_id: context.userId, _role: "admin" });
    if (!role) throw new Error("Forbidden");
    let latitude = data.latitude as number | undefined;
    let longitude = data.longitude as number | undefined;
    if (data.address && data.address.trim()) {
      const geo = await geocodeAddress(data.address);
      latitude = geo.latitude;
      longitude = geo.longitude;
    }
    if (typeof latitude !== "number" || typeof longitude !== "number") {
      throw new Error("Failed to resolve pin coordinates");
    }
    const { data: row, error } = await context.supabase
      .from("map_pins")
      .insert({
        title: data.title.trim(),
        description: data.description?.trim() || null,
        latitude,
        longitude,
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
