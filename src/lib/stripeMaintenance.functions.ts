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
import { type StripeEnv, createStripeClient, getStripeErrorMessage, assertAudCurrency } from "@/lib/stripe.server";
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
    product_name: "All-Access Pass · 3-Month Term",
    product_description: "A$27 upfront for 3 months of full members-only library access.",
    tax_code: TAX_CODES.saas,
  },
  all_access_6mo_monthly_aud: {
    product_id: "all_access_6mo",
    product_name: "All-Access Pass · 6-Month Term",
    product_description: "A$48 upfront for 6 months of full members-only library access.",
    tax_code: TAX_CODES.saas,
  },
  all_access_12mo_monthly_aud: {
    product_id: "all_access_12mo",
    product_name: "All-Access Pass · 12-Month Term",
    product_description: "A$84 upfront for 12 months of full members-only library access + a free event ticket.",
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

export type SyncMissingResult =
  | {
      results: Array<
        | { lookupKey: string; status: "exists"; priceId: string }
        | { lookupKey: string; status: "created"; priceId: string; productId: string }
        | { lookupKey: string; status: "skipped"; reason: string }
        | { lookupKey: string; status: "error"; message: string }
      >;
      created: number;
      existed: number;
      errors: number;
    }
  | { error: string };

/**
 * Admin-only: iterate the expected plan catalogue and create any Stripe
 * product/price whose lookup_key doesn't already resolve to an active price.
 * Idempotent — re-running only creates what's still missing. Never modifies
 * existing prices (mismatches surface via validatePlanPrice; changing
 * amount/interval requires a new price to preserve billing history).
 */
export const syncMissingStripePrices = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<SyncMissingResult> => {
    try {
      await assertAdmin(context);
      const stripe = createStripeClient(data.environment);

      const results: Extract<SyncMissingResult, { results: unknown }>["results"] = [];
      let created = 0;
      let existed = 0;
      let errors = 0;

      for (const [lookupKey, expected] of Object.entries(EXPECTED_PLAN_PRICES)) {
        const meta = PLAN_PRODUCT_CATALOGUE[lookupKey];
        if (!meta) {
          results.push({
            lookupKey,
            status: "skipped",
            reason: "No product metadata registered for this lookup_key",
          });
          continue;
        }

        try {
          const existing = await stripe.prices.list({
            lookup_keys: [lookupKey],
            active: true,
            limit: 1,
          });
          if (existing.data.length > 0) {
            results.push({ lookupKey, status: "exists", priceId: existing.data[0].id });
            existed++;
            continue;
          }

          // Reuse the product if it already exists; only create when missing.
          let productId: string | null = null;
          try {
            const product = await stripe.products.retrieve(meta.product_id);
            productId = product.id;
            if (product.tax_code !== meta.tax_code) {
              await stripe.products.update(product.id, { tax_code: meta.tax_code });
            }
          } catch {
            const product = await stripe.products.create({
              id: meta.product_id,
              name: meta.product_name,
              description: meta.product_description,
              tax_code: meta.tax_code,
            });
            productId = product.id;
          }

          const price = await stripe.prices.create({
            product: productId,
            currency: assertAudCurrency(expected.currency),
            unit_amount: expected.unit_amount,
            lookup_key: lookupKey,
            nickname: meta.product_name,
            transfer_lookup_key: true,
            ...(expected.interval && { recurring: { interval: expected.interval } }),
          });

          results.push({ lookupKey, status: "created", priceId: price.id, productId });
          created++;
        } catch (error) {
          const message = getStripeErrorMessage(error);
          console.error("[stripe-sync] failed", { lookupKey, message });
          results.push({ lookupKey, status: "error", message });
          errors++;
        }
      }

      return { results, created, existed, errors };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

/**
 * Term-pass plans that must be non-recurring one-time prices (lump sum
 * upfront for the term). Used by convertTermPassesToOneTime below.
 */
const TERM_PASS_LOOKUP_KEYS = [
  "all_access_3mo_monthly_aud",
  "all_access_6mo_monthly_aud",
  "all_access_12mo_monthly_aud",
] as const;

export type ConvertTermPassResult =
  | {
      results: Array<
        | { lookupKey: string; status: "converted"; oldPriceId: string; newPriceId: string }
        | { lookupKey: string; status: "already_one_time"; priceId: string }
        | { lookupKey: string; status: "missing" }
        | { lookupKey: string; status: "error"; message: string }
      >;
      converted: number;
    }
  | { error: string };

/**
 * Admin-only: for each 3/6/12-month term pass, if the active price in Stripe
 * is still `recurring` (legacy monthly billing), archive it and create a new
 * one-time price with `transfer_lookup_key: true` so the lookup_key follows.
 * The unit_amount comes from EXPECTED_PLAN_PRICES (2700/4800/8400 AUD cents).
 * Idempotent — a run after conversion returns `already_one_time`.
 */
export const convertTermPassesToOneTime = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }): Promise<ConvertTermPassResult> => {
    try {
      await assertAdmin(context);
      const stripe = createStripeClient(data.environment);

      const results: Extract<ConvertTermPassResult, { results: unknown }>["results"] = [];
      let converted = 0;

      for (const lookupKey of TERM_PASS_LOOKUP_KEYS) {
        try {
          const expected = EXPECTED_PLAN_PRICES[lookupKey];
          if (!expected) {
            results.push({ lookupKey, status: "error", message: "no expected price entry" });
            continue;
          }

          const found = await stripe.prices.list({
            lookup_keys: [lookupKey],
            active: true,
            limit: 1,
          });
          const current = found.data[0];
          if (!current) {
            results.push({ lookupKey, status: "missing" });
            continue;
          }

          // Already one-time with the correct amount — nothing to do.
          const isRecurring = !!current.recurring;
          if (!isRecurring && current.unit_amount === expected.unit_amount) {
            results.push({ lookupKey, status: "already_one_time", priceId: current.id });
            continue;
          }

          const productId =
            typeof current.product === "string" ? current.product : current.product?.id;
          if (!productId) {
            results.push({ lookupKey, status: "error", message: "price has no product" });
            continue;
          }

          // Create replacement first so lookup_key never points nowhere.
          const meta = PLAN_PRODUCT_CATALOGUE[lookupKey];
          const created = await stripe.prices.create({
            product: productId,
            currency: assertAudCurrency(expected.currency),
            unit_amount: expected.unit_amount,
            lookup_key: lookupKey,
            nickname: meta?.product_name ?? lookupKey,
            transfer_lookup_key: true,
            // No `recurring` field → one-time price.
          });

          // Archive the legacy price so nothing new can be sold on it.
          await stripe.prices.update(current.id, { active: false });

          results.push({
            lookupKey,
            status: "converted",
            oldPriceId: current.id,
            newPriceId: created.id,
          });
          converted++;
        } catch (error) {
          results.push({
            lookupKey,
            status: "error",
            message: getStripeErrorMessage(error),
          });
        }
      }

      return { results, converted };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

