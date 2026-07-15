import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXPECTED_PLAN_PRICES } from "@/lib/planPriceValidation.server";

// Fallback price when no priceId is supplied: the 30-day All-Access Pass.
const AAP30D_PRICE_CENTS = 1000; // A$10.00
const AAP30D_KEY = "aap30d";

/**
 * Human-readable descriptions per priceId. Kept alongside the price map so
 * NOWPayments' hosted invoice shows something meaningful to the buyer.
 */
const PRICE_DESCRIPTIONS: Record<string, string> = {
  all_access_monthly_aud: "All-Access Pass — monthly (Midnight Glory)",
  all_access_3mo_monthly_aud: "All-Access Pass — 3 months (Midnight Glory)",
  all_access_6mo_monthly_aud: "All-Access Pass — 6 months (Midnight Glory)",
  all_access_12mo_monthly_aud: "All-Access Pass — 12 months (Midnight Glory)",
  lifetime_onetime_aud: "Lifetime Membership (Midnight Glory)",
};

/**
 * Map a priceId to the short `kind` prefix encoded in the NOWPayments
 * `order_id`. The IPN webhook parses this prefix to decide which grant
 * RPC to call. Keep prefixes stable — they're persisted in NOWPayments'
 * invoice records.
 */
const PRICE_KIND: Record<string, string> = {
  lifetime_onetime_aud: "lifetime",
  // All-access recurring priceIds fall through to their raw priceId as kind
  // (webhook currently ignores them — recurring flow is not live).
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inputSchema = z
  .object({
    environment: z.enum(["sandbox", "live"]),
    returnOrigin: z.string().url(),
    /** Lookup key from EXPECTED_PLAN_PRICES (e.g. `lifetime_onetime_aud`). */
    priceId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    /** A single panty listing to purchase. Amount is derived from the
     *  listing row server-side. Mutually exclusive with `priceId`. */
    pantyListingId: z.string().regex(UUID_RE).optional(),
  })
  .refine((v) => !(v.priceId && v.pantyListingId), {
    message: "Pass either priceId or pantyListingId, not both",
  });

type Success = { invoiceUrl: string };
type Failure = { error: string };

/**
 * Creates a NOWPayments invoice and returns the hosted checkout URL.
 *
 * Amount, currency and description are always derived server-side (from
 * `EXPECTED_PLAN_PRICES` or the `panty_listings` row) so the client can't
 * influence what a user is charged. If neither `priceId` nor
 * `pantyListingId` is supplied, falls back to the 30-day All-Access Pass
 * (A$10.00).
 *
 * The IPN webhook (`/api/public/payments/nowpayments-webhook`) grants the
 * entitlement idempotently once payment settles. The `order_id` encodes
 * the kind so the webhook knows which grant RPC to call:
 *   - `aap30d:<userId>:<env>:<amt>`
 *   - `lifetime:<userId>:<env>:<amt>`
 *   - `panty:<listingId>:<userId>:<env>:<amt>`
 */
export const createNowpaymentsInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<Success | Failure> => {
    try {
      const { createInvoice } = await import("@/lib/nowpayments.server");

      let amountCents: number;
      let currency: string;
      let description: string;
      let orderId: string;

      if (data.pantyListingId) {
        // Look up the listing to derive amount + currency. Enforce
        // published + not-sold here so the buyer can't invoice a hidden
        // or already-sold pair.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: listing, error } = await supabaseAdmin
          .from("panty_listings")
          .select("id, title, price_cents, currency, published, sold")
          .eq("id", data.pantyListingId)
          .maybeSingle();
        if (error) return { error: `Listing lookup failed: ${error.message}` };
        if (!listing) return { error: "Listing not found" };
        if (!listing.published) return { error: "Listing is not available" };
        if (listing.sold) return { error: "Listing is already sold" };
        if (!listing.price_cents || listing.price_cents < 100) {
          return { error: "Listing has no valid price" };
        }
        amountCents = listing.price_cents;
        currency = (listing.currency ?? "aud").toLowerCase();
        description = `${listing.title ?? "Panty listing"} (Midnight Glory)`;
        orderId = `panty:${listing.id}:${context.userId}:${data.environment}:${amountCents}`;
      } else if (data.priceId) {
        const spec = EXPECTED_PLAN_PRICES[data.priceId];
        if (!spec) {
          return { error: `Unknown priceId: ${data.priceId}` };
        }
        amountCents = spec.unit_amount;
        currency = spec.currency;
        description = PRICE_DESCRIPTIONS[data.priceId] ?? data.priceId;
        const kind = PRICE_KIND[data.priceId] ?? data.priceId;
        orderId = `${kind}:${context.userId}:${data.environment}:${amountCents}`;
      } else {
        amountCents = AAP30D_PRICE_CENTS;
        currency = "aud";
        description = "All-Access Pass — 30 days (Midnight Glory)";
        orderId = `${AAP30D_KEY}:${context.userId}:${data.environment}:${amountCents}`;
      }

      const invoice = await createInvoice({
        priceAmount: amountCents / 100,
        priceCurrency: currency,
        orderId,
        orderDescription: description,
        ipnCallbackUrl: `${data.returnOrigin}/api/public/payments/nowpayments-webhook`,
        successUrl: `${data.returnOrigin}/checkout/return?provider=nowpayments&status=success`,
        cancelUrl: `${data.returnOrigin}/checkout/return?provider=nowpayments&status=cancel`,
      });
      return { invoiceUrl: invoice.invoice_url };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });

/**
 * Back-compat alias for the previous name. New code should import
 * `createNowpaymentsInvoice`.
 */
export const createAapInvoice = createNowpaymentsInvoice;
