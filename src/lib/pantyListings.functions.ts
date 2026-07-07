import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type PantyListing = {
  id: string;
  title: string;
  description: string | null;
  color: string | null;
  style: string | null;
  size: string | null;
  cover_url: string | null;
  media_urls: string[];
  price_cents: number | null;
  currency: string;
  published: boolean;
  sold: boolean;
  sort_order: number;
  created_at: string;
};

// Public: only published & unsold pairs.
export const listPantyListingsPublic = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase
    .from("panty_listings")
    .select(
      "id,title,description,color,style,size,cover_url,media_urls,price_cents,currency,published,sold,sort_order,created_at",
    )
    .eq("published", true)
    .eq("sold", false)
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as PantyListing[];
});

// Admin: all listings including drafts and sold.
export const listPantyListingsAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { data, error } = await context.supabase
      .from("panty_listings")
      .select(
        "id,title,description,color,style,size,cover_url,media_urls,price_cents,currency,published,sold,sort_order,created_at",
      )
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return (data ?? []) as PantyListing[];
  });

type ListingInput = {
  title: string;
  description?: string | null;
  color?: string | null;
  style?: string | null;
  size?: string | null;
  cover_url?: string | null;
  media_urls?: string[];
  price_cents?: number | null;
  published?: boolean;
  sold?: boolean;
  sort_order?: number;
};

function sanitize(input: ListingInput) {
  if (!input.title || input.title.trim().length < 1) throw new Error("Title required");
  return {
    title: input.title.trim().slice(0, 120),
    description: input.description?.slice(0, 2000) ?? null,
    color: input.color?.slice(0, 60) ?? null,
    style: input.style?.slice(0, 60) ?? null,
    size: input.size?.slice(0, 30) ?? null,
    cover_url: input.cover_url ?? null,
    media_urls: (input.media_urls ?? []).slice(0, 12),
    price_cents:
      input.price_cents == null
        ? null
        : Math.max(0, Math.min(1_000_000, Math.floor(input.price_cents))),
    published: !!input.published,
    sold: !!input.sold,
    sort_order: Math.max(0, Math.min(9999, Math.floor(input.sort_order ?? 0))),
  };
}

export const createPantyListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: ListingInput) => data)
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const clean = sanitize(data);
    const { data: row, error } = await context.supabase
      .from("panty_listings")
      .insert({ ...clean, created_by: context.userId })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

export const updatePantyListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string } & ListingInput) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error("Invalid id");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { id, ...rest } = data;
    const clean = sanitize(rest);
    const { error } = await context.supabase
      .from("panty_listings")
      .update(clean)
      .eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deletePantyListing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.id)) throw new Error("Invalid id");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: isAdmin } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("panty_listings")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
