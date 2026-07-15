import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";

/**
 * Editable All-Access Pass tier configuration. Drives both the
 * public /all-access-pass card grid and the NOWPayments checkout
 * price/description lookup. Admins edit rows via the admin dashboard.
 */

export type AllAccessTier = {
  id: string;
  plan_id: string;
  price_id: string | null;
  kind: string;
  label: string;
  price_display: string;
  cadence: string;
  perk: string | null;
  price_cents: number;
  currency: string;
  invoice_description: string;
  sort_order: number;
  is_active: boolean;
};

const SELECT_COLS =
  "id,plan_id,price_id,kind,label,price_display,cadence,perk,price_cents,currency,invoice_description,sort_order,is_active";

function serverPublishableClient() {
  const url = process.env.SUPABASE_URL!;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY!;
  return createClient<Database>(url, key, {
    auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    global: {
      fetch: (input, init) => {
        const h = new Headers(init?.headers);
        if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`)
          h.delete("Authorization");
        h.set("apikey", key);
        return fetch(input, { ...init, headers: h });
      },
    },
  });
}

/**
 * Public list — returns only ACTIVE tiers ordered for display. Used by
 * the /all-access-pass card grid at render time.
 */
export const listActiveAllAccessTiers = createServerFn({ method: "GET" }).handler(
  async (): Promise<AllAccessTier[]> => {
    const supa = serverPublishableClient();
    const { data, error } = await supa
      .from("all_access_pass_tiers")
      .select(SELECT_COLS)
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(`Failed to load tiers: ${error.message}`);
    return (data ?? []) as AllAccessTier[];
  },
);

/**
 * Admin list — returns EVERY tier including inactive ones. Requires the
 * caller to hold the `admin` role.
 */
export const listAllAccessTiersAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AllAccessTier[]> => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(`Role check failed: ${roleErr.message}`);
    if (!isAdmin) throw new Error("Forbidden");

    const { data, error } = await context.supabase
      .from("all_access_pass_tiers")
      .select(SELECT_COLS)
      .order("sort_order", { ascending: true });
    if (error) throw new Error(`Failed to load tiers: ${error.message}`);
    return (data ?? []) as AllAccessTier[];
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  label: z.string().min(1).max(80).optional(),
  price_display: z.string().min(1).max(32).optional(),
  cadence: z.string().min(1).max(32).optional(),
  perk: z.string().max(500).nullable().optional(),
  price_cents: z.number().int().min(100).max(10_000_000).optional(),
  invoice_description: z.string().min(1).max(200).optional(),
  sort_order: z.number().int().min(0).max(10_000).optional(),
  is_active: z.boolean().optional(),
});

export const updateAllAccessTier = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => updateSchema.parse(data))
  .handler(async ({ data, context }): Promise<AllAccessTier> => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(`Role check failed: ${roleErr.message}`);
    if (!isAdmin) throw new Error("Forbidden");

    const { id, ...patch } = data;
    if (Object.keys(patch).length === 0) throw new Error("No fields to update");

    const { data: row, error } = await context.supabase
      .from("all_access_pass_tiers")
      .update(patch)
      .eq("id", id)
      .select(SELECT_COLS)
      .maybeSingle();
    if (error) throw new Error(`Update failed: ${error.message}`);
    if (!row) throw new Error("Tier not found");
    return row as AllAccessTier;
  });
