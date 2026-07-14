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
  lifetime_onetime_aud: "All-Access Pass — Lifetime (Midnight Glory)",
};

const inputSchema = z.object({
  environment: z.enum(["sandbox", "live"]),
  returnOrigin: z.string().url(),
  /** Optional lookup key from EXPECTED_PLAN_PRICES. Omit for the default
   *  30-day All-Access Pass fallback. */
  priceId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
});

type Success = { invoiceUrl: string };
type Failure = { error: string };

/**
 * Creates a NOWPayments invoice and returns the hosted checkout URL.
 *
 * Amount, currency and description are always derived server-side from
 * `priceId` (looked up in EXPECTED_PLAN_PRICES) so the client can't
 * influence what a user is charged. If no priceId is supplied, falls back
 * to the 30-day All-Access Pass (A$10.00).
 *
 * The IPN webhook (`/api/public/payments/nowpayments-webhook`) grants the
 * entitlement idempotently once payment settles.
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
      let kind: string;

      if (data.priceId) {
        const spec = EXPECTED_PLAN_PRICES[data.priceId];
        if (!spec) {
          return { error: `Unknown priceId: ${data.priceId}` };
        }
        amountCents = spec.unit_amount;
        currency = spec.currency;
        description = PRICE_DESCRIPTIONS[data.priceId] ?? data.priceId;
        kind = data.priceId;
      } else {
        amountCents = AAP30D_PRICE_CENTS;
        currency = "aud";
        description = "All-Access Pass — 30 days (Midnight Glory)";
        kind = AAP30D_KEY;
      }

      const orderId = `${kind}:${context.userId}:${data.environment}:${amountCents}`;

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
