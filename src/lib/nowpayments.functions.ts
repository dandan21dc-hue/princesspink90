import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Fixed pricing for the current subscription-style flow. Kept in the
// server module so the client can't influence what a user is charged.
const AAP30D_PRICE_CENTS = 1000; // A$10.00

const inputSchema = z.object({
  environment: z.enum(["sandbox", "live"]),
  returnOrigin: z.string().url(),
});

type Success = { invoiceUrl: string };
type Failure = { error: string };

/**
 * Creates a NOWPayments invoice for the 30-day All-Access Pass. Returns
 * a hosted checkout URL the caller should redirect the user to. The
 * downstream webhook (`/api/public/payments/nowpayments-webhook`) grants
 * the pass idempotently once payment settles.
 */
export const createAapInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<Success | Failure> => {
    try {
      const { createInvoice } = await import("@/lib/nowpayments.server");
      const orderId = `aap30d:${context.userId}:${data.environment}:${AAP30D_PRICE_CENTS}`;
      const invoice = await createInvoice({
        priceAmount: AAP30D_PRICE_CENTS / 100,
        priceCurrency: "aud",
        orderId,
        orderDescription: "All-Access Pass — 30 days (Midnight Glory)",
        ipnCallbackUrl: `${data.returnOrigin}/api/public/payments/nowpayments-webhook`,
        successUrl: `${data.returnOrigin}/checkout/return?provider=nowpayments&status=success`,
        cancelUrl: `${data.returnOrigin}/checkout/return?provider=nowpayments&status=cancel`,
      });
      return { invoiceUrl: invoice.invoice_url };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
