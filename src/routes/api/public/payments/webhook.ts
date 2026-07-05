import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { type StripeEnv, verifyWebhook } from "@/lib/stripe.server";

let _supabase: ReturnType<typeof createClient<Database>> | null = null;
function getSupabase() {
  if (!_supabase) {
    _supabase = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
  }
  return _supabase;
}

async function notifyAllCreators(payload: {
  kind: string;
  title: string;
  body?: string;
  link_url?: string;
  metadata?: Record<string, any>;
}) {
  const { data: creators } = await getSupabase()
    .from("content_items")
    .select("creator_id");
  const ids = Array.from(new Set((creators ?? []).map((c) => c.creator_id).filter(Boolean)));
  if (ids.length === 0) return;
  await getSupabase().from("notifications").insert(
    ids.map((user_id) => ({
      user_id: user_id as string,
      kind: payload.kind,
      title: payload.title,
      body: payload.body ?? null,
      link_url: payload.link_url ?? null,
      metadata: (payload.metadata ?? {}) as any,
    })),
  );
}

async function handleSubscriptionUpsert(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) {
    console.error("No userId in subscription metadata");
    return;
  }
  const item = subscription.items?.data?.[0];
  const priceId =
    item?.price?.lookup_key || item?.price?.metadata?.lovable_external_id || item?.price?.id;
  const productId = item?.price?.product;
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  const { data: existing } = await getSupabase()
    .from("subscriptions")
    .select("id, status, cancel_at_period_end")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  await getSupabase()
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        stripe_subscription_id: subscription.id,
        stripe_customer_id: subscription.customer,
        product_id: productId,
        price_id: priceId,
        status: subscription.status,
        current_period_start: periodStart ? new Date(periodStart * 1000).toISOString() : null,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        cancel_at_period_end: subscription.cancel_at_period_end || false,
        environment: env,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "stripe_subscription_id" },
    );

  // Notify creators on new subscription
  if (!existing && (subscription.status === "active" || subscription.status === "trialing")) {
    await notifyAllCreators({
      kind: "subscription_started",
      title: "New subscriber 🎉",
      body: "Someone just started an all-access subscription.",
      link_url: "/dashboard",
      metadata: { subscription_id: subscription.id, env },
    });
  }
  // Notify on cancel-at-period-end toggle
  if (
    existing &&
    !existing.cancel_at_period_end &&
    subscription.cancel_at_period_end === true
  ) {
    await notifyAllCreators({
      kind: "subscription_canceling",
      title: "Subscriber canceled",
      body: "Their access continues until the end of the current period.",
      link_url: "/dashboard",
      metadata: { subscription_id: subscription.id, env },
    });
  }
}

async function handleSubscriptionDeleted(subscription: any, env: StripeEnv) {
  await getSupabase()
    .from("subscriptions")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env);
  await notifyAllCreators({
    kind: "subscription_canceled",
    title: "Subscription ended",
    body: "A subscriber's access has ended.",
    link_url: "/dashboard",
    metadata: { subscription_id: subscription.id, env },
  });
}

/**
 * Grant entitlements only after Stripe confirms funds have settled.
 *
 * `checkout.session.completed` fires as soon as the customer finishes the
 * checkout form, even for async payment methods (bank debits, some wallets)
 * where the money hasn't actually landed yet. For those, `payment_status`
 * is `"unpaid"` at completion and later flips via
 * `checkout.session.async_payment_succeeded` (paid) or
 * `checkout.session.async_payment_failed` (never paid).
 *
 * This function is the single "grant everything" path — called from both
 * `checkout.session.completed` (for instant-pay methods where payment_status
 * is already `"paid"`) and `checkout.session.async_payment_succeeded` (once
 * async funds settle). If payment_status isn't `"paid"`, we bail without
 * writing memberships/purchases so nothing gets unlocked prematurely.
 */
async function handleCheckoutCompleted(session: any, env: StripeEnv) {
  if (session.mode !== "payment") return;
  const userId = session.metadata?.userId;
  if (!userId) return;

  // GATE: only grant entitlements once funds have settled. Async payment
  // methods return here with payment_status "unpaid" and get processed
  // later by handleAsyncPaymentSucceeded.
  if (session.payment_status !== "paid") {
    console.log(
      "checkout.session.completed skipped: payment_status is",
      session.payment_status,
      "for session",
      session.id,
    );
    return;
  }

  // Private room booking — confirm the pre-created pending booking.
  if (session.metadata?.booking === "private_room") {
    const bookingId = session.metadata?.private_room_booking_id;
    if (bookingId) {
      await getSupabase()
        .from("private_room_bookings")
        .update({
          status: "confirmed",
          amount_cents: session.amount_total ?? null,
          stripe_session_id: session.id,
          environment: env,
          customer_email: session.customer_details?.email ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", bookingId);

      const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
      await notifyAllCreators({
        kind: "private_room_booking",
        title: `Private room booked — $${amount} 🔒`,
        body: "A private-room session has been paid for.",
        link_url: "/dashboard",
        metadata: { booking_id: bookingId, session_id: session.id, env } as any,
      });
    }
    return;
  }


  // Lifetime membership purchase
  if (session.metadata?.membership === "lifetime") {
    await getSupabase()
      .from("memberships")
      .upsert(
        {
          user_id: userId,
          kind: "lifetime",
          stripe_session_id: session.id,
          amount_cents: session.amount_total ?? 0,
          environment: env,
        },
        { onConflict: "user_id,kind,environment" },
      );
    const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
    await notifyAllCreators({
      kind: "lifetime_purchase",
      title: `New lifetime member — $${amount} 💎`,
      body: "Includes 1 free event ticket + 1 private session perk.",
      link_url: "/dashboard",
      metadata: { session_id: session.id, env } as any,
    });
    return;
  }

  // Term-pass (3/6/12-month all-access) purchase
  const termMonths = Number(session.metadata?.term_months);
  if (session.metadata?.membership === "term_pass" && [3, 6, 12].includes(termMonths)) {
    const kind = `term_pass_${termMonths}`;
    // If an existing pass is still active, extend from its expiry; otherwise from now.
    const { data: existing } = await getSupabase()
      .from("memberships")
      .select("id, expires_at")
      .eq("user_id", userId)
      .eq("kind", kind)
      .eq("environment", env)
      .maybeSingle();
    const now = new Date();
    const base =
      existing?.expires_at && new Date(existing.expires_at) > now
        ? new Date(existing.expires_at)
        : now;
    const expiresAt = new Date(base);
    expiresAt.setMonth(expiresAt.getMonth() + termMonths);

    await getSupabase()
      .from("memberships")
      .upsert(
        {
          user_id: userId,
          kind,
          stripe_session_id: session.id,
          amount_cents: session.amount_total ?? 0,
          environment: env,
          term_months: termMonths,
          expires_at: expiresAt.toISOString(),
        },
        { onConflict: "user_id,kind,environment" },
      );
    const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
    await notifyAllCreators({
      kind: "term_pass_purchase",
      title: `New ${termMonths}-month all-access member — $${amount} ✨`,
      body:
        termMonths === 12
          ? "12-month pass includes 1 free event ticket perk."
          : `${termMonths}-month all-access pass started.`,
      link_url: "/dashboard",
      metadata: { session_id: session.id, env, term_months: termMonths } as any,
    });
    return;
  }


  // One-time content-item purchase
  const contentItemId = session.metadata?.content_item_id;
  if (!contentItemId) return;

  await getSupabase()
    .from("content_purchases")
    .upsert(
      {
        user_id: userId,
        content_item_id: contentItemId,
        stripe_session_id: session.id,
        amount_cents: session.amount_total ?? 0,
        environment: env,
      },
      { onConflict: "user_id,content_item_id,environment" },
    );

  // Notify the specific creator of the item that was sold
  const { data: item } = await getSupabase()
    .from("content_items")
    .select("creator_id, title")
    .eq("id", contentItemId)
    .maybeSingle();
  if (item?.creator_id) {
    const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
    await getSupabase().from("notifications").insert({
      user_id: item.creator_id,
      kind: "sale",
      title: `New sale — $${amount}`,
      body: `Someone unlocked "${item.title ?? "your content"}".`,
      link_url: "/dashboard",
      metadata: { content_item_id: contentItemId, session_id: session.id, env } as any,
    });
  }
}

/**
 * Fires when an async payment method (delayed-settlement bank debit, etc.)
 * ultimately fails after `checkout.session.completed` already went out.
 *
 * At that point we've already been skipped by handleCheckoutCompleted (the
 * payment_status gate above), so no entitlements were granted — but for
 * private-room bookings the pending row still exists in the DB, holding
 * the slot. Roll it back so the calendar frees up and staff aren't
 * expecting the guest to show.
 */
async function handleAsyncPaymentFailed(session: any, env: StripeEnv) {
  if (session.metadata?.booking !== "private_room") return;
  const bookingId = session.metadata?.private_room_booking_id;
  if (!bookingId) return;
  await getSupabase()
    .from("private_room_bookings")
    .update({
      status: "canceled",
      stripe_session_id: session.id,
      environment: env,
      updated_at: new Date().toISOString(),
    })
    .eq("id", bookingId);
  await notifyAllCreators({
    kind: "private_room_booking_failed",
    title: "Private room payment failed",
    body: "An async payment for a private-room booking did not settle — the slot has been released.",
    link_url: "/dashboard",
    metadata: { booking_id: bookingId, session_id: session.id, env } as any,
  });
}

async function handleWebhook(req: Request, env: StripeEnv) {
  const event = await verifyWebhook(req, env);
  switch (event.type) {
    case "customer.subscription.created":
    case "customer.subscription.updated":
      await handleSubscriptionUpsert(event.data.object, env);
      break;
    case "customer.subscription.deleted":
      await handleSubscriptionDeleted(event.data.object, env);
      break;
    case "checkout.session.completed":
      // Instant-pay path. payment_status is enforced inside the handler so
      // async completions are ignored here and later re-processed via
      // checkout.session.async_payment_succeeded.
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case "checkout.session.async_payment_succeeded":
      // Funds settled for a delayed-settlement method. Same grant path;
      // the handler's payment_status === "paid" check will now pass.
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case "checkout.session.async_payment_failed":
      await handleAsyncPaymentFailed(event.data.object, env);
      break;
    default:
      console.log("Unhandled event:", event.type);
  }
}

export const Route = createFileRoute("/api/public/payments/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const rawEnv = new URL(request.url).searchParams.get("env");
        if (rawEnv !== "sandbox" && rawEnv !== "live") {
          console.error("Webhook: invalid env", rawEnv);
          return Response.json({ received: true, ignored: "invalid env" });
        }
        try {
          await handleWebhook(request, rawEnv as StripeEnv);
          return Response.json({ received: true });
        } catch (e) {
          console.error("Webhook error:", e);
          return new Response("Webhook error", { status: 400 });
        }
      },
    },
  },
});
