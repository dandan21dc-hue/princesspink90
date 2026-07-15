/**
 * Authoritative NOWPayments price lookup. Sources every All-Access Pass
 * amount + description from the editable `all_access_pass_tiers` table so
 * admins can adjust prices from the dashboard without a redeploy. The
 * client never supplies the amount — only the priceId lookup key.
 */
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type PlanPriceSpec = {
  unit_amount: number; // cents
  currency: string; // typically 'aud'
  description: string; // invoice line description
  kind: string; // order_id prefix (e.g. 'lifetime', 'aap90d')
};

function serverClient() {
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
 * Look up the authoritative amount/currency/description for a checkout
 * priceId. Returns null when the priceId is unknown or the tier is
 * disabled — the caller surfaces this as "Unknown priceId".
 */
export async function getPlanPriceSpec(priceId: string): Promise<PlanPriceSpec | null> {
  const supa = serverClient();
  const { data, error } = await supa
    .from("all_access_pass_tiers")
    .select("price_cents,currency,invoice_description,kind,is_active")
    .eq("price_id", priceId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return {
    unit_amount: data.price_cents,
    currency: data.currency,
    description: data.invoice_description,
    kind: data.kind,
  };
}

/**
 * Look up the 30-day All-Access Pass default (invoked when the client
 * does not send a priceId). Falls back to A$10 / "aap30d" if the row is
 * missing so checkout never hard-fails.
 */
export async function getDefaultAap30dSpec(): Promise<PlanPriceSpec> {
  const supa = serverClient();
  const { data } = await supa
    .from("all_access_pass_tiers")
    .select("price_cents,currency,invoice_description,kind,is_active")
    .eq("plan_id", "all_access_30d_aud")
    .eq("is_active", true)
    .maybeSingle();
  if (data) {
    return {
      unit_amount: data.price_cents,
      currency: data.currency,
      description: data.invoice_description,
      kind: data.kind,
    };
  }
  return {
    unit_amount: 1000,
    currency: "aud",
    description: "All-Access Pass — 30 days (Midnight Glory)",
    kind: "aap30d",
  };
}
