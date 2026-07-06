import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";
import { TAX_CODES, isEligibleForManagedPayments } from "@/lib/stripe-tax-codes";
import type Stripe from "stripe";

type CheckoutResult = { clientSecret: string } | { error: string };

// ---------- Public reads ----------

export const listStoreItems = createServerFn({ method: "GET" }).handler(async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const supabase = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { data, error } = await supabase
    .from("content_items")
    .select("id,kind,title,description,cover_url,price_cents,currency,subscribers_only,created_at")
    .eq("published", true)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
});

export const getStoreItem = createServerFn({ method: "GET" })
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: row, error } = await supabase
      .from("content_items")
      .select("id,kind,title,description,cover_url,price_cents,currency,subscribers_only,created_at")
      .eq("id", data.id)
      .eq("published", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return row;
  });

// Public read: busy time ranges for the private room within [from, to].
export const listPrivateRoomBusy = createServerFn({ method: "GET" })
  .inputValidator((data: { from: string; to: string }) => {
    if (!data.from || !data.to) throw new Error("from/to required");
    return data;
  })
  .handler(async ({ data }) => {
    const { createClient } = await import("@supabase/supabase-js");
    const supabase = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_PUBLISHABLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data: rows, error } = await supabase.rpc("get_private_room_busy", {
      from_ts: data.from,
      to_ts: data.to,
    });
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ starts_at: string; duration_minutes: number }>;
  });



// ---------- Authenticated ----------

async function resolveOrCreateCustomer(
  stripe: ReturnType<typeof createStripeClient>,
  options: { email?: string; userId?: string },
): Promise<string> {
  if (options.userId && !/^[a-zA-Z0-9_-]+$/.test(options.userId)) throw new Error("Invalid userId");
  if (options.userId) {
    const found = await stripe.customers.search({
      query: `metadata['userId']:'${options.userId}'`,
      limit: 1,
    });
    if (found.data.length) return found.data[0].id;
  }
  if (options.email) {
    const existing = await stripe.customers.list({ email: options.email, limit: 1 });
    if (existing.data.length) {
      const customer = existing.data[0];
      if (options.userId && customer.metadata?.userId !== options.userId) {
        await stripe.customers.update(customer.id, {
          metadata: { ...customer.metadata, userId: options.userId },
        });
      }
      return customer.id;
    }
  }
  const created = await stripe.customers.create({
    ...(options.email && { email: options.email }),
    ...(options.userId && { metadata: { userId: options.userId } }),
  });
  return created.id;
}

export function ensureSessionIdInReturnUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("returnUrl must be http(s)");
  }
  if (rawUrl.includes("{CHECKOUT_SESSION_ID}")) return rawUrl;
  const [beforeHash, hash = ""] = rawUrl.split("#");
  const sep = beforeHash.includes("?") ? "&" : "?";
  const withTemplate = `${beforeHash}${sep}session_id={CHECKOUT_SESSION_ID}`;
  return hash ? `${withTemplate}#${hash}` : withTemplate;
}

/**
 * Server-side gate: Panty Drawer purchases require an active all-access
 * subscription, an active term pass, or a lifetime membership in the same
 * environment. Frontend UI is never trusted for this — every panty checkout
 * path (single-item + cart) MUST call this before creating a Stripe session.
 * Uses the request-scoped supabase client (RLS as the caller).
 */
async function assertPantyAccess(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  userId: string,
  env: StripeEnv,
): Promise<void> {
  const nowIso = new Date().toISOString();

  const sub = await supabase
    .from("subscriptions")
    .select("status,current_period_end")
    .eq("user_id", userId)
    .eq("environment", env)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sub.error) throw new Error(sub.error.message);
  const s = sub.data as { status: string; current_period_end: string | null } | null;
  const subActive = !!s && (
    (["active", "trialing", "past_due"].includes(s.status)
      && (!s.current_period_end || s.current_period_end > nowIso))
    || (s.status === "canceled" && !!s.current_period_end && s.current_period_end > nowIso)
  );

  if (subActive) return;

  const mem = await supabase
    .from("memberships")
    .select("kind,expires_at")
    .eq("user_id", userId)
    .eq("environment", env);

  if (mem.error) throw new Error(mem.error.message);
  const rows = (mem.data ?? []) as Array<{ kind: string; expires_at: string | null }>;
  const memActive = rows.some((m) =>
    m.kind === "lifetime"
    || (m.kind.startsWith("term_pass_") && !!m.expires_at && m.expires_at > nowIso),
  );

  if (!memActive) {
    throw new Error(
      "The Panty Drawer is a members-only perk — grab an all-access pass or lifetime membership first.",
    );
  }
}

// ---------- Subscriber discount (Panty Drawer) ----------
//
// Active subscribers/members already gate through assertPantyAccess to buy
// panties at all. As a thank-you, every panty checkout gets a persistent
// 15% Stripe coupon applied. The coupon is created once per Stripe
// environment on first use (idempotent by id) and re-used forever after.

export const SUBSCRIBER_DISCOUNT_PERCENT = 15;
const SUBSCRIBER_COUPON_ID = "subscriber_pantry_15";

async function ensureSubscriberCoupon(stripe: Stripe): Promise<string> {
  try {
    await stripe.coupons.retrieve(SUBSCRIBER_COUPON_ID);
  } catch (err: unknown) {
    const code = (err as { code?: string; statusCode?: number } | null)?.code
      ?? (err as { raw?: { code?: string } } | null)?.raw?.code;
    const status = (err as { statusCode?: number } | null)?.statusCode;
    if (code === "resource_missing" || status === 404) {
      await stripe.coupons.create({
        id: SUBSCRIBER_COUPON_ID,
        percent_off: SUBSCRIBER_DISCOUNT_PERCENT,
        duration: "forever",
        name: `Subscriber ${SUBSCRIBER_DISCOUNT_PERCENT}% off (Panty Drawer)`,
      });
    } else {
      throw err;
    }
  }
  return SUBSCRIBER_COUPON_ID;
}

/**
 * Non-throwing subscriber check for UI use (mirrors assertPantyAccess).
 */
export const getSubscriberStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { environment: StripeEnv }) => data)
  .handler(async ({ data, context }) => {
    try {
      await assertPantyAccess(context.supabase, context.userId, data.environment);
      return { isSubscriber: true, discountPercent: SUBSCRIBER_DISCOUNT_PERCENT };
    } catch {
      return { isSubscriber: false, discountPercent: 0 };
    }
  });




export const createStoreCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      priceId?: string;
      contentItemId?: string;
      quantity?: number;
      customerEmail?: string;
      userId?: string;
      returnUrl: string;
      environment: StripeEnv;
      bookingStartsAt?: string;
      customerCountry?: string;
    }) => {
      if (!data.priceId && !data.contentItemId) throw new Error("priceId or contentItemId required");
      if (data.priceId && !/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
      if (data.contentItemId && !/^[a-f0-9-]+$/i.test(data.contentItemId)) throw new Error("Invalid item id");
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      // SECURITY: never trust client-supplied userId. Bind checkout to the
      // authenticated caller so an attacker cannot create sessions or
      // bookings on behalf of another user.
      data = { ...data, userId: context.userId };
      const stripe = createStripeClient(data.environment);
      const customerId =
        data.customerEmail || data.userId
          ? await resolveOrCreateCustomer(stripe, {
              email: data.customerEmail,
              userId: data.userId,
            })
          : undefined;

      const customerCountry = (data.customerCountry ?? "").toUpperCase() || undefined;

      // Subscription / lookup-key checkout
      if (data.priceId) {
        const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
        const stripePrice = prices.data[0];
        // Validate against the expected catalogue (interval + amount).
        // Logs a structured event when the plan is missing or misconfigured
        // in Stripe so drift is visible in server function logs.
        const { validatePlanPrice } = await import("@/lib/planPriceValidation.server");
        const issue = validatePlanPrice(data.priceId, stripePrice);
        if (!stripePrice) throw new Error("Price not found");
        if (issue?.kind === "mismatch") {
          throw new Error(
            `Plan ${issue.lookupKey} is misconfigured in Stripe (${issue.fields.join(", ")}). Please contact support.`,
          );
        }
        const isRecurring = stripePrice.type === "recurring";

        // Retrieve product so we can (a) description one-time payments and
        // (b) ensure the product carries the correct tax code for tax
        // calculation / managed_payments eligibility.
        const productId =
          typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;
        const product = await stripe.products.retrieve(productId);
        const productDescription = product.name;

        const isLifetime = data.priceId === "lifetime_onetime_aud";
        // Accept both the newer `_onetime_aud` and legacy `_monthly_aud`
        // naming — both are now one-time upfront term passes.
        const termPassMatch = /^all_access_(3|6|12)mo_(onetime|monthly)_aud$/.exec(data.priceId);
        const termMonths = termPassMatch ? Number(termPassMatch[1]) : null;
        const isPanty = /^panty_(24|48|72)hr_aud$/.test(data.priceId);
        const privateRoomMatch = /^private_room_(30|60)min_aud$/.exec(data.priceId);
        const privateRoomMinutes = privateRoomMatch ? Number(privateRoomMatch[1]) : null;

        // Members-only gate for the Panty Drawer. Never trust the client —
        // enforce active subscription/membership before creating the session.
        if (isPanty) {
          await assertPantyAccess(context.supabase, context.userId, data.environment);
        }

        // Tax codes are set once via scripts/sync-stripe-tax-codes.mjs.
        // We no longer patch them per checkout — that hid API failures and
        // added latency to every payment. If a product is misconfigured,
        // re-run the sync script.


        // Private room: create a pending booking BEFORE checkout so the slot
        // is held. Verify no overlap. Amount now comes from Stripe (source
        // of truth) instead of a hardcoded switch.
        let privateRoomBookingId: string | null = null;
        if (privateRoomMinutes) {
          if (!data.userId) throw new Error("Sign in required to book the private room");
          if (!data.bookingStartsAt) throw new Error("Please pick a start time");
          const startsAt = new Date(data.bookingStartsAt);
          if (Number.isNaN(startsAt.getTime())) throw new Error("Invalid start time");
          if (startsAt.getTime() < Date.now() + 60 * 60 * 1000) {
            throw new Error("Bookings must be at least 1 hour in advance");
          }
          const endsAt = new Date(startsAt.getTime() + privateRoomMinutes * 60_000);
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          const { data: busy, error: busyErr } = await supabaseAdmin.rpc(
            "get_private_room_busy",
            { from_ts: startsAt.toISOString(), to_ts: endsAt.toISOString() },
          );
          if (busyErr) throw new Error(busyErr.message);
          if ((busy ?? []).length > 0) throw new Error("That time is no longer available. Please pick another slot.");
          const env = data.environment;
          const { data: booking, error: bookErr } = await supabaseAdmin
            .from("private_room_bookings")
            .insert({
              user_id: data.userId,
              starts_at: startsAt.toISOString(),
              duration_minutes: privateRoomMinutes,
              status: "pending",
              amount_cents: stripePrice.unit_amount ?? 0,
              currency: (stripePrice.currency ?? "aud").toLowerCase(),
              environment: env,
              customer_email: data.customerEmail ?? null,
            })
            .select("id")
            .single();
          if (bookErr || !booking) throw new Error(bookErr?.message ?? "Could not hold slot");
          privateRoomBookingId = booking.id as string;
        }

        // Full tax compliance: use managed_payments for digital SKUs; panty
        // orders fall back to automatic_tax so tax is still calculated.
        const useManagedPayments = isEligibleForManagedPayments(data.priceId);

        const baseParams: Stripe.Checkout.SessionCreateParams = {
          line_items: [{ price: stripePrice.id, quantity: data.quantity || 1 }],
          mode: isRecurring ? "subscription" : "payment",
          ui_mode: "embedded_page",
          return_url: ensureSessionIdInReturnUrl(data.returnUrl),
          ...(customerId && { customer: customerId }),
          ...(!isRecurring && !useManagedPayments && {
            payment_intent_data: { description: productDescription },
          }),
          ...(isPanty && {
            shipping_address_collection: { allowed_countries: ["AU"] },
            shipping_options: [
              {
                shipping_rate_data: {
                  type: "fixed_amount",
                  display_name: "Discreet AU shipping",
                  fixed_amount: { amount: 1500, currency: "aud" },
                },
              },
            ],
            // Every panty checkout is gated to active subscribers/members,
            // so unconditionally apply the subscriber thank-you discount.
            discounts: [{ coupon: await ensureSubscriberCoupon(stripe) }],
          }),
          metadata: {
            ...(data.userId && { userId: data.userId }),
            ...(isLifetime && { membership: "lifetime" }),
            ...(termMonths && { membership: "term_pass", term_months: String(termMonths) }),
            ...(isRecurring && data.priceId && { subscription: data.priceId }),
            ...(isPanty && { panty_order: data.priceId }),
            ...(privateRoomBookingId && {
              booking: "private_room",
              private_room_booking_id: privateRoomBookingId,
            }),
            managed_payments: useManagedPayments ? "true" : "false",
            ...(customerCountry && { customer_country: customerCountry }),
          },

          ...(isRecurring && data.userId && {
            subscription_data: { metadata: { userId: data.userId } },
          }),
        };

        // Attach the tax handling that matches our compliance decision.
        // managed_payments is dahlia-preview and not in the SDK types yet.
        const paramsWithTax = useManagedPayments
          ? ({ ...baseParams, managed_payments: { enabled: true } } as unknown as Stripe.Checkout.SessionCreateParams)
          : { ...baseParams, automatic_tax: { enabled: true } };

        const session = await stripe.checkout.sessions.create(paramsWithTax);

        // Save Stripe session id on the pending booking so the webhook can confirm it.
        if (privateRoomBookingId) {
          const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
          await supabaseAdmin
            .from("private_room_bookings")
            .update({ stripe_session_id: session.id })
            .eq("id", privateRoomBookingId);
        }

        return { clientSecret: session.client_secret ?? "" };
      }

      // One-time item checkout via contentItemId + dynamic price_data.
      // Currency is read from the item, not hardcoded.
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: item, error } = await supabase
        .from("content_items")
        .select("id,title,description,price_cents,currency,published")
        .eq("id", data.contentItemId!)
        .eq("published", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!item) throw new Error("Item not found");
      if (!item.price_cents || item.price_cents < 50) throw new Error("Item is not for individual sale");

      const itemCurrency = (item.currency ?? "aud").toLowerCase();

      const contentParams: Stripe.Checkout.SessionCreateParams = {
        line_items: [
          {
            price_data: {
              currency: itemCurrency,
              product_data: {
                name: item.title,
                ...(item.description && { description: item.description.slice(0, 500) }),
                tax_code: TAX_CODES.digital_goods,
              },
              unit_amount: item.price_cents,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: ensureSessionIdInReturnUrl(data.returnUrl),
        ...(customerId && { customer: customerId }),
        metadata: {
          ...(data.userId && { userId: data.userId }),
          content_item_id: item.id,
          managed_payments: "true",
          ...(customerCountry && { customer_country: customerCountry }),
        },
      };

      const paramsWithManaged = {
        ...contentParams,
        managed_payments: { enabled: true },
      } as unknown as Stripe.Checkout.SessionCreateParams;

      const session = await stripe.checkout.sessions.create(paramsWithManaged);
      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });

// ---------- Cart checkout (multi-item, one-time only) ----------

const PANTY_LOOKUP = ["panty_24hr_aud", "panty_48hr_aud", "panty_72hr_aud"] as const;
type PantyLookup = (typeof PANTY_LOOKUP)[number];

type CartItemInput =
  | { kind: "content"; id: string; quantity: number }
  | { kind: "panty"; id: PantyLookup; quantity: number };

/**
 * Multi-item checkout: builds ONE Stripe Checkout Session with N line items.
 * Only one-time SKUs are cartable (subscriptions and private-room bookings
 * cannot share a session). Server-authoritative on prices — the client
 * merely says "id + quantity", we look up the actual price/amount.
 */
export const createCartCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      items: CartItemInput[];
      returnUrl: string;
      environment: StripeEnv;
      customerEmail?: string;
      customerCountry?: string;
      /** Client-generated correlation id (UUID) so pre-checkout analytics
       *  events can be reconciled with the Stripe session created here. */
      clientOrderRef?: string;
    }) => {
      if (!Array.isArray(data.items) || data.items.length === 0) {
        throw new Error("Cart is empty");
      }
      if (data.items.length > 20) throw new Error("Too many items in cart");
      for (const it of data.items) {
        if (it.kind === "content") {
          if (!/^[a-f0-9-]+$/i.test(it.id)) throw new Error("Invalid content id");
        } else if (it.kind === "panty") {
          if (!PANTY_LOOKUP.includes(it.id)) throw new Error("Invalid panty variant");
        } else {
          throw new Error("Unsupported cart item");
        }
        if (!Number.isInteger(it.quantity) || it.quantity < 1 || it.quantity > 10) {
          throw new Error("Invalid quantity");
        }
        // Panty rows are unique per checkout session (schema constraint) and
        // don't have a per-order quantity column — enforce single-pair.
        if (it.kind === "panty" && it.quantity !== 1) {
          throw new Error("Only one of each panty variant per order");
        }
      }
      // Same reason — only one distinct panty variant per checkout session.
      const pantyCount = data.items.filter((it) => it.kind === "panty").length;
      if (pantyCount > 1) {
        throw new Error("Only one panty variant per order — check out separately");
      }
      if (data.clientOrderRef !== undefined) {
        if (typeof data.clientOrderRef !== "string" || data.clientOrderRef.length > 64) {
          throw new Error("Invalid clientOrderRef");
        }
        if (!/^[a-zA-Z0-9_-]+$/.test(data.clientOrderRef)) {
          throw new Error("Invalid clientOrderRef");
        }
      }
      return data;
    },
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    try {
      const userId = context.userId;
      const stripe = createStripeClient(data.environment);
      const customerId = await resolveOrCreateCustomer(stripe, {
        email: data.customerEmail,
        userId,
      });

      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );

      // Split for lookup
      const contentIds = data.items.filter((it) => it.kind === "content").map((it) => it.id);
      const pantyItems = data.items.filter((it) => it.kind === "panty") as Array<{
        kind: "panty";
        id: PantyLookup;
        quantity: number;
      }>;

      // Members-only gate: any panty item in the cart requires an active
      // subscription/membership. Verified against the authenticated user's
      // RLS-scoped client, never trusting the frontend cart contents.
      if (pantyItems.length > 0) {
        await assertPantyAccess(context.supabase, userId, data.environment);
      }



      // Fetch content items in one query
      let contentRows: Array<{
        id: string;
        title: string;
        description: string | null;
        price_cents: number | null;
        currency: string | null;
        published: boolean;
      }> = [];
      if (contentIds.length) {
        const { data: rows, error } = await supabase
          .from("content_items")
          .select("id,title,description,price_cents,currency,published")
          .in("id", contentIds)
          .eq("published", true);
        if (error) throw new Error(error.message);
        contentRows = rows ?? [];
      }
      const contentMap = new Map(contentRows.map((r) => [r.id, r]));

      // Fetch panty prices in one call (lookup keys) so amounts stay
      // Stripe-authoritative.
      const pantyPriceMap = new Map<PantyLookup, Stripe.Price>();
      if (pantyItems.length) {
        const uniqueKeys = Array.from(new Set(pantyItems.map((it) => it.id)));
        const prices = await stripe.prices.list({
          lookup_keys: uniqueKeys,
          active: true,
          expand: ["data.product"],
        });
        for (const p of prices.data) {
          if (p.lookup_key && PANTY_LOOKUP.includes(p.lookup_key as PantyLookup)) {
            pantyPriceMap.set(p.lookup_key as PantyLookup, p);
          }
        }
      }

      // Build Stripe line_items
      const lineItems: NonNullable<Stripe.Checkout.SessionCreateParams["line_items"]> = [];
      for (const it of data.items) {
        if (it.kind === "content") {
          const row = contentMap.get(it.id);
          if (!row) throw new Error("An item in your cart is no longer available");
          if (!row.price_cents || row.price_cents < 50) {
            throw new Error(`"${row.title}" is not available for individual sale`);
          }
          lineItems.push({
            price_data: {
              currency: (row.currency ?? "aud").toLowerCase(),
              product_data: {
                name: row.title,
                ...(row.description && { description: row.description.slice(0, 500) }),
                tax_code: TAX_CODES.digital_goods,
              },
              unit_amount: row.price_cents,
            },
            quantity: it.quantity,
          });
        } else {
          const price = pantyPriceMap.get(it.id);
          if (!price) throw new Error(`Panty variant ${it.id} is not currently available`);
          lineItems.push({ price: price.id, quantity: it.quantity });
        }
      }

      const hasPanty = pantyItems.length > 0;
      const customerCountry = (data.customerCountry ?? "").toUpperCase() || undefined;

      // Pack cart layout into session metadata for webhook fulfillment.
      // Metadata values cap at 500 chars — 20 items x ~40 chars fits.
      const cartContentMeta = data.items
        .filter((it) => it.kind === "content")
        .map((it) => `${it.id}:${it.quantity}`)
        .join(",");
      const cartPantyMeta = pantyItems.map((it) => `${it.id}:${it.quantity}`).join(",");

      // Full-compliance managed_payments only for digital-only carts. Panty
      // present → automatic_tax so shipping tax is still calculated.
      const useManagedPayments = !hasPanty;

      const baseParams: Stripe.Checkout.SessionCreateParams = {
        line_items: lineItems,
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: ensureSessionIdInReturnUrl(data.returnUrl),
        customer: customerId,
        ...(!useManagedPayments && {
          payment_intent_data: { description: "Princess Pink cart order" },
        }),
        ...(hasPanty && {
          shipping_address_collection: { allowed_countries: ["AU"] },
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount",
                display_name: "Discreet AU shipping",
                fixed_amount: { amount: 1500, currency: "aud" },
              },
            },
          ],
          // Panty items in the cart are gated to subscribers; apply the
          // subscriber thank-you discount to the whole order.
          discounts: [{ coupon: await ensureSubscriberCoupon(stripe) }],
        }),
        metadata: {
          userId,
          cart_mode: "1",
          ...(cartContentMeta && { cart_content_items: cartContentMeta }),
          ...(cartPantyMeta && { cart_panty_items: cartPantyMeta }),
          managed_payments: useManagedPayments ? "true" : "false",
          ...(customerCountry && { customer_country: customerCountry }),
          ...(data.clientOrderRef && { client_order_ref: data.clientOrderRef }),
        },
      };

      const paramsWithTax = useManagedPayments
        ? ({ ...baseParams, managed_payments: { enabled: true } } as unknown as Stripe.Checkout.SessionCreateParams)
        : { ...baseParams, automatic_tax: { enabled: true } };

      const session = await stripe.checkout.sessions.create(paramsWithTax);
      return { clientSecret: session.client_secret ?? "" };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });


// ---------- Library (owned content) ----------

export const getMyLibrary = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const env = process.env.NODE_ENV === "production" ? "live" : "sandbox";
    const { data: sub } = await supabase
      .from("subscriptions")
      .select("status,current_period_end")
      .eq("user_id", userId)
      .eq("environment", env)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const now = Date.now();
    const periodEnd = sub?.current_period_end ? new Date(sub.current_period_end).getTime() : null;
    const hasRecurring = !!sub && (
      (["active", "trialing", "past_due"].includes(sub.status) && (!periodEnd || periodEnd > now))
      || (sub.status === "canceled" && !!periodEnd && periodEnd > now)
    );

    const { data: memberships } = await supabase
      .from("memberships")
      .select("kind,expires_at")
      .eq("user_id", userId)
      .eq("environment", env);
    const hasMembershipAccess = (memberships ?? []).some((m) => {
      if (m.kind === "lifetime") return true;
      if (m.kind?.startsWith("term_pass_") && m.expires_at) {
        return new Date(m.expires_at).getTime() > now;
      }
      return false;
    });

    const hasSubscription = hasRecurring || hasMembershipAccess;

    const { data: purchases } = await supabase
      .from("content_purchases")
      .select("content_item_id,created_at")
      .eq("user_id", userId)
      .eq("environment", env);
    const purchasedIds = new Set((purchases ?? []).map((p) => p.content_item_id));

    const query = supabase
      .from("content_items")
      .select("id,kind,title,description,cover_url,media_urls,subscribers_only,price_cents,currency,created_at")
      .eq("published", true)
      .order("created_at", { ascending: false });
    const { data: allItems } = await query;

    // Simplified: subscribers see everything; non-subscribers see items
    // they've bought individually.
    const unlocked = (allItems ?? []).filter(
      (item) => hasSubscription || purchasedIds.has(item.id),
    );

    return { hasSubscription, items: unlocked };
  });

// ---------- Admin (creator) ----------

export const createContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      kind: "photo_set" | "video" | "bundle";
      title: string;
      description?: string;
      cover_url?: string;
      price_cents?: number | null;
      currency?: "aud" | "usd";
      subscribers_only?: boolean;
      media_urls?: Array<{ url: string; type: "image" | "video" }>;
      published?: boolean;
    }) => {
      if (!data.title.trim() || data.title.length > 160) throw new Error("Title required (max 160 chars)");
      if (data.price_cents != null && (data.price_cents < 0 || data.price_cents > 1_000_00)) throw new Error("Price out of range");
      if (data.currency && !["aud", "usd"].includes(data.currency)) throw new Error("Currency must be AUD or USD");
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { data: row, error } = await supabase
      .from("content_items")
      .insert({
        creator_id: userId,
        kind: data.kind,
        title: data.title.trim(),
        description: data.description?.trim() || null,
        cover_url: data.cover_url || null,
        price_cents: data.price_cents ?? null,
        currency: data.currency ?? "aud",
        subscribers_only: data.subscribers_only ?? false,
        media_urls: (data.media_urls ?? []) as any,
        published: data.published ?? true,
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const listMyContent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("content_items")
      .select("id,kind,title,price_cents,currency,subscribers_only,published,created_at")
      .eq("creator_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const deleteContentItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("content_items")
      .delete()
      .eq("id", data.id)
      .eq("creator_id", userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// Signed URL for owned or accessible media
export const signMediaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { itemId: string; path: string }) => data)
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const env = process.env.NODE_ENV === "production" ? "live" : "sandbox";
    const { data: allowed } = await supabase.rpc("user_can_access_content", {
      _user_id: userId,
      _content_id: data.itemId,
      _env: env,
    });
    if (!allowed) throw new Error("Not allowed");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error } = await supabaseAdmin.storage
      .from("content-media")
      .createSignedUrl(data.path, 60 * 10);
    if (error || !signed) throw new Error(error?.message ?? "Sign failed");
    return { url: signed.signedUrl };
  });

/**
 * Fetch a Checkout Session from Stripe by id, scoped to the signed-in user
 * via the metadata.userId stamp. Used by the /checkout/return landing page
 * to confirm status and route the user to the right destination.
 */
export const getCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { sessionId: string; environment: StripeEnv }) => {
    if (!/^cs_[a-zA-Z0-9_]+$/.test(data.sessionId)) throw new Error("Invalid session id");
    return data;
  })
  .handler(async ({ data, context }): Promise<
    | {
        status: string | null;
        metadata: Record<string, string> | null;
        session_id: string;
        payment_intent_id: string | null;
        amount_total: number | null;
        currency: string | null;
        order_ids: string[];
      }
    | { error: string }
  > => {
    try {
      const stripe = createStripeClient(data.environment);
      const session = await stripe.checkout.sessions.retrieve(data.sessionId);
      const metadata = (session.metadata ?? {}) as Record<string, string>;
      // Security: only expose the session to its owner.
      if (metadata.userId && metadata.userId !== context.userId) {
        throw new Error("Not allowed");
      }
      const paymentIntentId =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : (session.payment_intent?.id ?? null);

      // Reconciliation: return the panty_orders row id(s) the webhook created
      // for this session so client tracking can include order_id alongside the
      // Stripe identifiers. RLS scopes this read to the session's owner.
      const { data: orders } = await context.supabase
        .from("panty_orders")
        .select("id")
        .eq("stripe_session_id", session.id);
      const orderIds = (orders ?? []).map((o) => o.id as string);

      return {
        status: session.status ?? null,
        metadata,
        session_id: session.id,
        payment_intent_id: paymentIntentId,
        amount_total: session.amount_total ?? null,
        currency: session.currency ?? null,
        order_ids: orderIds,
      };
    } catch (error) {
      return { error: getStripeErrorMessage(error) };
    }
  });
