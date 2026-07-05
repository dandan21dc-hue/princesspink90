import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  type StripeEnv,
  createStripeClient,
  getStripeErrorMessage,
} from "@/lib/stripe.server";

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
    .select("id,kind,title,description,cover_url,price_cents,subscribers_only,created_at")
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
      .select("id,kind,title,description,cover_url,price_cents,subscribers_only,created_at")
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

export const createStoreCheckoutSession = createServerFn({ method: "POST" })
  .inputValidator(
    (data: {
      priceId?: string;
      contentItemId?: string;
      quantity?: number;
      customerEmail?: string;
      userId?: string;
      returnUrl: string;
      environment: StripeEnv;
      bookingStartsAt?: string; // ISO timestamp for private-room bookings
    }) => {
      if (!data.priceId && !data.contentItemId) throw new Error("priceId or contentItemId required");
      if (data.priceId && !/^[a-zA-Z0-9_-]+$/.test(data.priceId)) throw new Error("Invalid priceId");
      if (data.contentItemId && !/^[a-f0-9-]+$/i.test(data.contentItemId)) throw new Error("Invalid item id");
      return data;
    },
  )

  .handler(async ({ data }): Promise<CheckoutResult> => {
    try {
      const stripe = createStripeClient(data.environment);
      const customerId =
        data.customerEmail || data.userId
          ? await resolveOrCreateCustomer(stripe, {
              email: data.customerEmail,
              userId: data.userId,
            })
          : undefined;

      // Subscription checkout via priceId
      if (data.priceId) {
        const prices = await stripe.prices.list({ lookup_keys: [data.priceId] });
        if (!prices.data.length) throw new Error("Price not found");
        const stripePrice = prices.data[0];
        const isRecurring = stripePrice.type === "recurring";

        let productDescription: string | undefined;
        if (!isRecurring) {
          const productId =
            typeof stripePrice.product === "string" ? stripePrice.product : stripePrice.product.id;
          const product = await stripe.products.retrieve(productId);
          productDescription = product.name;
        }

        const isLifetime = data.priceId === "lifetime_onetime_aud" || data.priceId === "lifetime_onetime";
        const termPassMatch = /^all_access_(3|6|12)mo_onetime(?:_aud)?$/.exec(data.priceId);
        const termMonths = termPassMatch ? Number(termPassMatch[1]) : null;
        const isPanty = /^panty_(24|48|72)hr_aud$/.test(data.priceId);
        const privateRoomMatch = /^private_room_(30|60)min_aud$/.exec(data.priceId);
        const privateRoomMinutes = privateRoomMatch ? Number(privateRoomMatch[1]) : null;

        // Private room: create a pending booking BEFORE checkout so the slot is
        // held. Verify no overlap with confirmed or recent-pending bookings.
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
              amount_cents: privateRoomMinutes === 30 ? 15000 : 27500,
              currency: "aud",
              environment: env,
              customer_email: data.customerEmail ?? null,
            })
            .select("id")
            .single();
          if (bookErr || !booking) throw new Error(bookErr?.message ?? "Could not hold slot");
          privateRoomBookingId = booking.id as string;
        }


        const session = await stripe.checkout.sessions.create({
          line_items: [{ price: stripePrice.id, quantity: data.quantity || 1 }],
          mode: isRecurring ? "subscription" : "payment",
          ui_mode: "embedded_page",
          return_url: data.returnUrl,
          ...(customerId && { customer: customerId }),
          ...(!isRecurring && { payment_intent_data: { description: productDescription } }),
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
          }),
          ...(data.userId && {
            metadata: {
              userId: data.userId,
              ...(isLifetime && { membership: "lifetime" }),
              ...(termMonths && { membership: "term_pass", term_months: String(termMonths) }),
              ...(isPanty && { panty_order: data.priceId }),
              ...(privateRoomBookingId && {
                booking: "private_room",
                private_room_booking_id: privateRoomBookingId,
              }),
            },
            ...(isRecurring && { subscription_data: { metadata: { userId: data.userId } } }),
          }),
        });

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

      // One-time item checkout via contentItemId + dynamic price_data
      const { createClient } = await import("@supabase/supabase-js");
      const supabase = createClient(
        process.env.SUPABASE_URL!,
        process.env.SUPABASE_PUBLISHABLE_KEY!,
        { auth: { persistSession: false, autoRefreshToken: false } },
      );
      const { data: item, error } = await supabase
        .from("content_items")
        .select("id,title,description,price_cents,published")
        .eq("id", data.contentItemId!)
        .eq("published", true)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!item) throw new Error("Item not found");
      if (!item.price_cents || item.price_cents < 50) throw new Error("Item is not for individual sale");

      const session = await stripe.checkout.sessions.create({
        line_items: [
          {
            price_data: {
              currency: "usd",
              product_data: {
                name: item.title,
                ...(item.description && { description: item.description.slice(0, 500) }),
              },
              unit_amount: item.price_cents,
            },
            quantity: 1,
          },
        ],
        mode: "payment",
        ui_mode: "embedded_page",
        return_url: data.returnUrl,
        ...(customerId && { customer: customerId }),
        payment_intent_data: { description: item.title },
        metadata: {
          ...(data.userId && { userId: data.userId }),
          content_item_id: item.id,
        },
      });
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
    // Determine subscription
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

    // Lifetime or active term-pass memberships also unlock the library
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

    // If subscribed, unlock all published items; else only purchased ones
    const query = supabase
      .from("content_items")
      .select("id,kind,title,description,cover_url,media_urls,subscribers_only,price_cents,created_at")
      .eq("published", true)
      .order("created_at", { ascending: false });
    const { data: allItems } = await query;

    const unlocked = (allItems ?? []).filter(
      (item) => hasSubscription || purchasedIds.has(item.id) || item.subscribers_only === false && purchasedIds.has(item.id),
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
      subscribers_only?: boolean;
      media_urls?: Array<{ url: string; type: "image" | "video" }>;
      published?: boolean;
    }) => {
      if (!data.title.trim() || data.title.length > 160) throw new Error("Title required (max 160 chars)");
      if (data.price_cents != null && (data.price_cents < 0 || data.price_cents > 1_000_00)) throw new Error("Price out of range");
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
        subscribers_only: data.subscribers_only ?? false,
        media_urls: (data.media_urls ?? []) as any,
        published: data.published ?? true,
      })
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
      .select("id,kind,title,price_cents,subscribers_only,published,created_at")
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

// Generate a signed URL for a media path (bucket: content-media)
export const signMediaUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { path: string; contentItemId: string }) => data)
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const env = process.env.NODE_ENV === "production" ? "live" : "sandbox";
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Check access
    const { data: allowed } = await supabaseAdmin.rpc("user_can_access_content", {
      _user_id: userId,
      _content_id: data.contentItemId,
      _env: env,
    });
    if (!allowed) throw new Error("Not entitled to this content");

    const { data: signed, error } = await supabaseAdmin.storage
      .from("content-media")
      .createSignedUrl(data.path, 60 * 60);
    if (error) throw new Error(error.message);
    return { url: signed.signedUrl };
  });
