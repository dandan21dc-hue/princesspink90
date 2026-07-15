import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXPECTED_PLAN_PRICES } from "@/lib/planPriceValidation.server";
import { resolveAppOrigin } from "@/lib/app-origin.server";
import { assertAccountNotRestricted } from "@/lib/account-restriction";


// Fallback price when no priceId is supplied: the 30-day All-Access Pass.
const AAP30D_PRICE_CENTS = 1000; // A$10.00
const AAP30D_KEY = "aap30d";

/**
 * Human-readable descriptions per priceId. Kept alongside the price map so
 * NOWPayments' hosted invoice shows something meaningful to the buyer.
 */
const PRICE_DESCRIPTIONS: Record<string, string> = {
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

/** Private-room booking priceIds — amount comes from `site_settings`. */
const PRIVATE_ROOM_PRICE_RE = /^private_room_(30|60)min_aud$/;

const inputSchema = z
  .object({
    environment: z.enum(["sandbox", "live"]),
    // Ignored server-side (kept optional for backwards compatibility) — the
    // effective origin is derived from the incoming request via `resolveAppOrigin`.
    returnOrigin: z.string().url().optional(),
    /** Lookup key from EXPECTED_PLAN_PRICES or a dynamic pattern below
     *  (e.g. `lifetime_onetime_aud`, `private_room_30min_aud`). */
    priceId: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/).optional(),
    /** A single panty listing to purchase. Amount is derived from the
     *  listing row server-side. Must be the `panty_listings.id` UUID —
     *  legacy Stripe lookup keys (e.g. `panty_24hr_aud`) are rejected. */
    pantyListingId: z
      .string()
      .regex(UUID_RE, {
        message:
          "pantyListingId must be a panty_listings.id UUID (8-4-4-4-12 hex). Legacy Stripe lookup keys like `panty_24hr_aud` are no longer accepted — remove the item from your cart and add the current listing again.",
      })
      .optional(),
    /** A single published, priced content item to purchase. Amount is
     *  derived from the `content_items` row server-side. */
    contentItemId: z
      .string()
      .regex(UUID_RE, {
        message:
          "contentItemId must be a content_items.id UUID (8-4-4-4-12 hex).",
      })
      .optional(),
    /** Reward points to redeem (10 pts = $1.00 discount). Verified and
     *  reserved server-side against the caller's balance. Only honoured
     *  for panty listings for now. */
    pointsToApply: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine(
    (v) => [v.priceId, v.pantyListingId, v.contentItemId].filter(Boolean).length <= 1,
    { message: "Pass at most one of priceId, pantyListingId, or contentItemId" },
  );

/**
 * Redact a raw invalid identifier for a client-facing error message. Ids
 * themselves aren't PII (they're either UUIDs or short lookup keys), but
 * we still cap length and strip control chars so a hostile client can't
 * echo arbitrary text back through our own error surface.
 */
function describeInvalidId(value: unknown): string {
  if (typeof value !== "string") return `received ${typeof value}`;
  const cleaned = value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 64);
  const suffix = value.length > 64 ? "…" : "";
  return `received "${cleaned}${suffix}" (${value.length} chars)`;
}

/**
 * Turn a Zod issue into a caller-actionable message. UUID failures on
 * `pantyListingId` / `contentItemId` are the common case — echo which
 * field, why it failed, and a redacted view of what was received so the
 * shopper knows exactly which cart line to fix.
 */
function formatValidationError(issue: z.ZodIssue, input: unknown): string {
  const field = issue.path.join(".") || "input";
  const received = (input && typeof input === "object")
    ? (input as Record<string, unknown>)[String(issue.path[0])]
    : undefined;
  if (
    (field === "pantyListingId" || field === "contentItemId") &&
    (issue.code === "invalid_format" || issue.code === "invalid_type")
  ) {
    return `Invalid checkout request: ${field} — ${issue.message} ${describeInvalidId(received)}.`;
  }
  return `Invalid checkout request: ${field} — ${issue.message}`;
}

type Success = { invoiceUrl: string };
type Failure = { error: string };

/**
 * Creates a NOWPayments invoice and returns the hosted checkout URL.
 *
 * Amount, currency and description are always derived server-side (from
 * `EXPECTED_PLAN_PRICES`, `panty_listings`, `content_items`, or
 * `site_settings`) so the client can't influence what a user is charged.
 * If nothing is supplied, falls back to the 30-day All-Access Pass
 * (A$10.00).
 *
 * The IPN webhook (`/api/public/payments/nowpayments-webhook`) grants the
 * entitlement idempotently once payment settles. The `order_id` encodes
 * the kind so the webhook knows which grant RPC to call:
 *   - `aap30d:<userId>:<env>:<amt>`
 *   - `lifetime:<userId>:<env>:<amt>`
 *   - `panty:<listingId>:<userId>:<env>:<amt>`
 *   - `content:<itemId>:<userId>:<env>:<amt>`
 *   - `private_room_<mins>:<userId>:<env>:<amt>`
 */
/**
 * Parse + validate an incoming checkout payload. Throws a caller-actionable
 * `Error` on failure (never a raw ZodError, which would escape as an
 * unhandled runtime error on the client and render a blank screen).
 * Exported so unit tests can exercise the exact error surface that
 * `createNowpaymentsInvoice`'s inputValidator produces.
 */
export function parseCheckoutInput(data: unknown): z.infer<typeof inputSchema> {
  const result = inputSchema.safeParse(data);
  if (result.success) return result.data;
  const first = result.error.issues[0];
  if (!first) throw new Error("Invalid checkout request: input — invalid");
  throw new Error(formatValidationError(first, data));
}

export const createNowpaymentsInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => parseCheckoutInput(data))
  .handler(async ({ data, context }): Promise<Success | Failure> => {
    try {
      await assertAccountNotRestricted(context.supabase, context.userId);
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

        // Reward-point redemption (10 pts = $1.00 = 100 cents). Cap so
        // the invoice remains ≥ $1.00 (NOWPayments minimum) and the
        // discount can never exceed the item price.
        let pointsApplied = 0;
        if (data.pointsToApply && data.pointsToApply > 0) {
          const maxByPrice = Math.floor((amountCents - 100) / 10);
          pointsApplied = Math.max(0, Math.min(data.pointsToApply, maxByPrice));
          if (pointsApplied > 0) {
            const provisionalOrderId = `panty:${listing.id}:${context.userId}:${data.environment}:pending`;
            const { error: reserveErr } = await supabaseAdmin.rpc(
              "reserve_reward_points",
              {
                _order_id: provisionalOrderId,
                _user_id: context.userId,
                _points: pointsApplied,
              },
            );
            if (reserveErr) {
              return {
                error:
                  reserveErr.message === "insufficient_reward_points"
                    ? "You don't have enough reward points for that discount."
                    : `Couldn't reserve reward points: ${reserveErr.message}`,
              };
            }
            amountCents = amountCents - pointsApplied * 10;
            // Move the reservation onto the final order_id so the webhook
            // can find and consume it after payment settles.
            const finalOrderId = `panty:${listing.id}:${context.userId}:${data.environment}:${amountCents}:p${pointsApplied}`;
            await supabaseAdmin
              .from("reward_point_reservations")
              .update({ order_id: finalOrderId })
              .eq("order_id", provisionalOrderId);
            orderId = finalOrderId;
          } else {
            orderId = `panty:${listing.id}:${context.userId}:${data.environment}:${amountCents}`;
          }
        } else {
          orderId = `panty:${listing.id}:${context.userId}:${data.environment}:${amountCents}`;
        }
      } else if (data.contentItemId) {
        // Look up the content item so amount + currency come from the
        // authoritative row, not the client. Only published items with a
        // real price are purchasable this way.
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: item, error } = await supabaseAdmin
          .from("content_items")
          .select("id, title, kind, price_cents, currency, published")
          .eq("id", data.contentItemId)
          .maybeSingle();
        if (error) return { error: `Content item lookup failed: ${error.message}` };
        if (!item) return { error: "Content item not found" };
        if (!item.published) return { error: "Content item is not available" };
        if (!item.price_cents || item.price_cents < 100) {
          return { error: "Content item has no valid price" };
        }
        amountCents = item.price_cents;
        currency = (item.currency ?? "aud").toLowerCase();
        description = `${item.title ?? "Content item"} (Midnight Glory)`;
        orderId = `content:${item.id}:${context.userId}:${data.environment}:${amountCents}`;
      } else if (data.priceId && PRIVATE_ROOM_PRICE_RE.test(data.priceId)) {
        // Private-room bookings: amount lives in `site_settings.session_price_cents`
        // (admin-configured). The priceId encodes the duration so the
        // webhook / booking flow can size the slot.
        const minutes = Number(PRIVATE_ROOM_PRICE_RE.exec(data.priceId)![1]);
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { data: settings, error } = await supabaseAdmin
          .from("site_settings")
          .select("session_price_cents")
          .maybeSingle();
        if (error) return { error: `Session pricing lookup failed: ${error.message}` };
        if (!settings?.session_price_cents || settings.session_price_cents < 100) {
          return { error: "Private-room session price is not configured" };
        }
        amountCents = settings.session_price_cents;
        currency = "aud";
        description = `Private Room — ${minutes} minutes (Midnight Glory)`;
        orderId = `private_room_${minutes}:${context.userId}:${data.environment}:${amountCents}`;
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

      // Ignore any client-supplied `returnOrigin`; always build URLs from
      // the server-verified app origin so an attacker can't redirect a
      // paying customer or divert the IPN webhook to a domain they control.
      const appOrigin = resolveAppOrigin(getRequest());
      const invoice = await createInvoice({
        priceAmount: amountCents / 100,
        priceCurrency: currency,
        orderId,
        orderDescription: description,
        ipnCallbackUrl: `${appOrigin}/api/public/payments/nowpayments-webhook`,
        successUrl: `${appOrigin}/checkout/return?provider=nowpayments&status=success`,
        cancelUrl: `${appOrigin}/checkout/return?provider=nowpayments&status=cancel`,
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
