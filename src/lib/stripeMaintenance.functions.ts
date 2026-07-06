/**
 * Admin-only maintenance actions:
 *  - syncStripeTaxCodes: idempotently sets tax codes on catalogue products.
 *  - archiveUsdPrices: deactivates legacy USD lookup keys (AUD is now sole
 *    surface currency; USD prices exist in Stripe but no UI ships them).
 *
 * Only callable by users with the `admin` role. Reads secrets via
 * createStripeClient (gateway) so no Stripe key needs to leave the server.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { type StripeEnv, createStripeClient, getStripeErrorMessage } from "@/lib/stripe.server";
import { TAX_CODES } from "@/lib/stripe-tax-codes";
import { EXPECTED_PLAN_PRICES } from "@/lib/planPriceValidation.server";

/**
 * Catalogue metadata for lookup_keys we expect to exist in Stripe. Used by
 * syncMissingStripePrices to create any missing product/price pair. Keys
 * MUST match EXPECTED_PLAN_PRICES; product_name/description drive what shows
 * on the Stripe dashboard and receipts.
 */
const PLAN_PRODUCT_CATALOGUE: Record<
  string,
  { product_id: string; product_name: string; product_description: string; tax_code: string }
> = {
  all_access_3mo_monthly_aud: {
    product_id: "all_access_3mo",
    product_name: "All-Access Pass · 3-Month Plan",
    product_description: "Monthly billing for 3 months — full members-only library.",
    tax_code: TAX_CODES.saas,
  },
  all_access_6mo_monthly_aud: {
    product_id: "all_access_6mo",
    product_name: "All-Access Pass · 6-Month Plan",
    product_description: "Monthly billing for 6 months — full members-only library.",
    tax_code: TAX_CODES.saas,
  },
  all_access_12mo_monthly_aud: {
    product_id: "all_access_12mo",
    product_name: "All-Access Pass · 12-Month Plan",
    product_description: "Monthly billing for 12 months — full members-only library + free event entry.",
    tax_code: TAX_CODES.saas,
  },
  lifetime_onetime_aud: {
    product_id: "lifetime",
    product_name: "Lifetime Membership",
    product_description: "One-time payment for forever access + a free event ticket and private session bundle.",
    tax_code: TAX_CODES.saas,
  },
};


const USD_LOOKUP_KEYS = [
  "all_access_monthly",
  "all_access_3mo_onetime",
  "all_access_6mo_onetime",
  "all_access_12mo_onetime",
  "lifetime_onetime",
] as const;

async function assertAdmin(context: { supabase: any; userId: string }) {
  const { data } = await context.supabase.rpc("has_role", {
    _user_id: context.userId,
    _role: "admin",
  });
  if (!data) throw new Error("Admin access required");
}

/** Category rules — map a lookup_key prefix to a tax code. */
function taxCodeFor(lookupKey: string): string {
  if (/^panty_/.test(lookupKey)) return TAX_CODES.physical_goods;
  if (/^private_room_/.test(lookupKey)) return TAX_CODES.services;
  // All access & lifetime & term passes → SaaS
  return TAX_CODES.saas;
}

export const syncStripeTaxCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ updated: number; skipped: number; total: number } | { error: string }> => {
    try {
      await assertAdmin(context);
      const stripe = createStripeClient(data.environment);

      // Walk active prices, one page at a time, collecting distinct product ids.
      const products = new Map<string, { current?: string; desired: string }>();
      let hasMore = true;
      let starting_after: string | undefined;
      while (hasMore) {
        const page: any = await stripe.prices.list({ active: true, limit: 100, ...(starting_after && { starting_after }) });
        for (const p of page.data) {
          if (!p.lookup_key) continue;
          const productId = typeof p.product === "string" ? p.product : p.product?.id;
          if (!productId) continue;
          if (!products.has(productId)) {
            products.set(productId, { desired: taxCodeFor(p.lookup_key) });
          }
        }
        hasMore = page.has_more;
        starting_after = page.data[page.data.length - 1]?.id;
      }

      let updated = 0;
      let skipped = 0;
      for (const [productId, info] of products) {
        const product: any = await stripe.products.retrieve(productId);
        info.current = product.tax_code ?? undefined;
        if (info.current === info.desired) {
          skipped++;
          continue;
        }
        await stripe.products.update(productId, { tax_code: info.desired });
        updated++;
      }
      return { updated, skipped, total: products.size };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

export const archiveUsdPrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<{ archived: number; alreadyInactive: number } | { error: string }> => {
    try {
      await assertAdmin(context);
      const stripe = createStripeClient(data.environment);
      let archived = 0;
      let alreadyInactive = 0;
      for (const key of USD_LOOKUP_KEYS) {
        const found = await stripe.prices.list({ lookup_keys: [key], active: true, limit: 5 });
        for (const price of found.data) {
          if (!price.active) {
            alreadyInactive++;
            continue;
          }
          await stripe.prices.update(price.id, { active: false });
          archived++;
        }
      }
      return { archived, alreadyInactive };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
