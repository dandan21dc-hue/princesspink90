import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { type StripeEnv, verifyWebhook, createStripeClient } from "@/lib/stripe.server";

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
    .select("id, status, cancel_at_period_end, current_period_end")
    .eq("stripe_subscription_id", subscription.id)
    .eq("environment", env)
    .maybeSingle();

  // Guard against out-of-order `customer.subscription.updated` events.
  //
  // Stripe does not guarantee webhook delivery order: a stale `updated`
  // event with status "active" can arrive after we've already processed
  // the terminal `deleted` event (or an earlier `updated` that flipped
  // the row to "canceled"). Without this guard, that stale event would
  // upsert the row back to "active" and silently re-grant paid access
  // for the remainder of the period.
  //
  // Once a subscription is canceled locally, the only legitimate way for
  // that same `stripe_subscription_id` to come back is via Stripe itself
  // resurrecting it — which Stripe doesn't do; a resubscribe always
  // issues a new subscription id. So: if we have a canceled row, ignore
  // any non-canceled update for that id.
  if (
    existing &&
    existing.status === "canceled" &&
    subscription.status !== "canceled"
  ) {
    console.log(
      "handleSubscriptionUpsert: ignoring stale event for canceled subscription",
      subscription.id,
      "incoming status:",
      subscription.status,
    );
    return;
  }

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
 * Multi-item cart fulfillment. Parses the packed metadata written by
 * `createCartCheckoutSession` and inserts one row per line item:
 *   - `cart_content_items = "uuid:qty,uuid:qty,..."`
 *   - `cart_panty_items   = "panty_24hr_aud:qty,panty_48hr_aud:qty,..."`
 * Amounts for content purchases come from Stripe's line-items API so the
 * ledger stays accurate even with taxes / discounts.
 */
async function handleCartSession(session: any, env: StripeEnv) {
  const userId = session.metadata?.userId;
  if (!userId) return;

  const parseMeta = (raw: string | undefined): Array<{ id: string; qty: number }> => {
    if (!raw) return [];
    return raw
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [id, qtyRaw] = part.split(":");
        const qty = Math.max(1, Number(qtyRaw) || 1);
        return { id, qty };
      })
      .filter((x) => x.id);
  };

  const contentEntries = parseMeta(session.metadata?.cart_content_items);
  const pantyEntries = parseMeta(session.metadata?.cart_panty_items);

  // Pull line items so we can attribute paid amounts back to each row.
  let lineItems: any[] = [];
  try {
    const stripe = createStripeClient(env);
    const list = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 100,
      expand: ["data.price"],
    });
    lineItems = list.data ?? [];
  } catch (e) {
    console.error("cart fulfillment: listLineItems failed", e);
  }

  // Match content items by product name (price_data.product_data.name = title)
  const remainingLines = [...lineItems];
  const takeLineByPredicate = (pred: (li: any) => boolean) => {
    const idx = remainingLines.findIndex(pred);
    if (idx < 0) return null;
    const [li] = remainingLines.splice(idx, 1);
    return li;
  };

  // Content purchases
  for (const entry of contentEntries) {
    const { data: item } = await getSupabase()
      .from("content_items")
      .select("id, title, creator_id")
      .eq("id", entry.id)
      .maybeSingle();
    if (!item) continue;

    const li = takeLineByPredicate(
      (l) => (l.description ?? l.price?.product_data?.name) === item.title,
    );
    const amountCents = li?.amount_total ?? 0;

    await getSupabase()
      .from("content_purchases")
      .upsert(
        {
          user_id: userId,
          content_item_id: item.id,
          stripe_session_id: session.id,
          amount_cents: amountCents,
          environment: env,
        },
        { onConflict: "user_id,content_item_id,environment" },
      );

    if (item.creator_id) {
      const amountLabel = (amountCents / 100).toFixed(2);
      await getSupabase().from("notifications").insert({
        user_id: item.creator_id,
        kind: "sale",
        title: `New sale — $${amountLabel}`,
        body: `Someone unlocked "${item.title ?? "your content"}" (via cart).`,
        link_url: "/dashboard",
        metadata: {
          content_item_id: item.id,
          session_id: session.id,
          env,
          via: "cart",
        } as any,
      });
    }
  }

  // Panty orders — one row per (variant, session). Qty > 1 becomes qty on the row.
  const ship =
    session.collected_information?.shipping_details ??
    session.shipping_details ??
    null;
  const addr = ship?.address ?? null;

  for (const entry of pantyEntries) {
    const match = /^panty_(24|48|72)hr_aud$/.exec(entry.id);
    if (!match) continue;
    const hours = Number(match[1]);
    const li = takeLineByPredicate((l) => l.price?.lookup_key === entry.id);
    const amountCents = li?.amount_total ?? 0;

    await (getSupabase() as any)
      .from("panty_orders")
      .upsert(
        {
          user_id: userId,
          variant: entry.id,
          hours,
          quantity: entry.qty,
          stripe_session_id: session.id,
          amount_cents: amountCents,
          currency: (session.currency ?? "aud").toLowerCase(),
          environment: env,
          status: "paid",
          customer_email: session.customer_details?.email ?? null,
          shipping_name: ship?.name ?? session.customer_details?.name ?? null,
          shipping_line1: addr?.line1 ?? null,
          shipping_line2: addr?.line2 ?? null,
          shipping_city: addr?.city ?? null,
          shipping_state: addr?.state ?? null,
          shipping_postal_code: addr?.postal_code ?? null,
          shipping_country: addr?.country ?? null,
        },
        { onConflict: "stripe_session_id,variant" },
      );

    const amountLabel = (amountCents / 100).toFixed(2);
    await notifyAllCreators({
      kind: "panty_order",
      title: `New ${hours}h panty order — $${amountLabel} 🩲`,
      body: `Cart order, quantity ${entry.qty}. Ship discreetly to the address on file.`,
      link_url: "/dashboard",
      metadata: {
        session_id: session.id,
        env,
        hours,
        variant: entry.id,
        quantity: entry.qty,
        via: "cart",
      } as any,
    });
  }
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

  // Multi-item cart order: fan out into content_purchases + panty_orders.
  if (session.metadata?.cart_mode === "1") {
    await handleCartSession(session, env);
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


  // Panty order (24 / 48 / 72 hour worn variants). Session carries
  // `panty_order` = "panty_24hr_aud" | "panty_48hr_aud" | "panty_72hr_aud",
  // plus a shipping address collected at checkout.
  const pantyOrder = session.metadata?.panty_order as string | undefined;
  const pantyMatch = pantyOrder ? /^panty_(24|48|72)hr_aud$/.exec(pantyOrder) : null;
  if (pantyMatch) {
    const hours = Number(pantyMatch[1]);
    // Stripe puts the collected shipping address under `collected_information`
    // on the new API and `shipping_details` on older ones — read both.
    const ship =
      session.collected_information?.shipping_details ??
      session.shipping_details ??
      null;
    const addr = ship?.address ?? null;
    await (getSupabase() as any)
      .from("panty_orders")
      .upsert(
        {
          user_id: userId,
          variant: pantyOrder,
          hours,
          stripe_session_id: session.id,
          amount_cents: session.amount_total ?? 0,
          currency: (session.currency ?? "aud").toLowerCase(),
          environment: env,
          status: "paid",
          customer_email: session.customer_details?.email ?? null,
          shipping_name: ship?.name ?? session.customer_details?.name ?? null,
          shipping_line1: addr?.line1 ?? null,
          shipping_line2: addr?.line2 ?? null,
          shipping_city: addr?.city ?? null,
          shipping_state: addr?.state ?? null,
          shipping_postal_code: addr?.postal_code ?? null,
          shipping_country: addr?.country ?? null,
        },
        { onConflict: "stripe_session_id" },
      );
    const amount = ((session.amount_total ?? 0) / 100).toFixed(2);
    await notifyAllCreators({
      kind: "panty_order",
      title: `New ${hours}h panty order — $${amount} 🩲`,
      body: "Ship it discreetly to the address on file.",
      link_url: "/dashboard",
      metadata: { session_id: session.id, env, hours, variant: pantyOrder } as any,
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

/**
 * Look up the Checkout Session tied to a Stripe Charge/Dispute so we can
 * find the local rows we wrote from `stripe_session_id`. Charges/disputes
 * carry `payment_intent`, not `session.id`, so we ask Stripe.
 */
async function findSessionByPaymentIntent(paymentIntent: string, env: StripeEnv) {
  try {
    const stripe = createStripeClient(env);
    const list = await stripe.checkout.sessions.list({
      payment_intent: paymentIntent,
      limit: 1,
    });
    return list.data[0] ?? null;
  } catch (e) {
    console.error("findSessionByPaymentIntent failed:", e);
    return null;
  }
}

/**
 * Revoke every entitlement granted from a given Checkout Session:
 * - delete content purchase rows (locks the item behind the paywall again)
 * - delete membership rows (lifetime or term_pass) — user_can_access_content
 *   no longer matches
 * - cancel any private-room booking (frees the slot)
 *
 * Deleting is safe because the source of truth is the Stripe session; if a
 * dispute later resolves in the seller's favor we replay
 * handleCheckoutCompleted(session) to re-grant.
 */
async function revokeEntitlementsForSession(session: any, env: StripeEnv) {
  const sessionId = session.id as string;
  const nowIso = new Date().toISOString();

  await getSupabase()
    .from("content_purchases")
    .delete()
    .eq("stripe_session_id", sessionId)
    .eq("environment", env);

  await getSupabase()
    .from("memberships")
    .delete()
    .eq("stripe_session_id", sessionId)
    .eq("environment", env);

  await getSupabase()
    .from("private_room_bookings")
    .update({ status: "cancelled", updated_at: nowIso })
    .eq("stripe_session_id", sessionId)
    .eq("environment", env);

  // Physical panty order — keep the row (we still need shipping records for
  // returns / audit) but mark it refunded so admins stop fulfilling it.
  await (getSupabase() as any)
    .from("panty_orders")
    .update({ status: "refunded", updated_at: nowIso })
    .eq("stripe_session_id", sessionId)
    .eq("environment", env);
}

/**
 * charge.refunded — fires on every refund (partial or full). We only revoke
 * on a full refund; partial refunds don't unlock/lock a digital good.
 */
async function handleChargeRefunded(charge: any, env: StripeEnv) {
  if (!charge?.payment_intent) return;
  const fullyRefunded =
    charge.refunded === true ||
    (typeof charge.amount === "number" &&
      typeof charge.amount_refunded === "number" &&
      charge.amount_refunded >= charge.amount);
  if (!fullyRefunded) {
    console.log("charge.refunded: partial refund, no revoke for", charge.id);
    return;
  }
  const session = await findSessionByPaymentIntent(charge.payment_intent, env);
  if (!session) return;
  await revokeEntitlementsForSession(session, env);
  await notifyAllCreators({
    kind: "refund",
    title: "Purchase refunded — access revoked",
    body: "A charge was fully refunded; the buyer no longer has access.",
    link_url: "/dashboard",
    metadata: { session_id: session.id, charge_id: charge.id, env } as any,
  });
}

/**
 * charge.dispute.created — freeze access as soon as a chargeback opens.
 * If we later win the dispute we restore via handleDisputeClosed.
 */
async function handleDisputeCreated(dispute: any, env: StripeEnv) {
  if (!dispute?.payment_intent) return;
  const session = await findSessionByPaymentIntent(dispute.payment_intent, env);
  if (!session) return;
  await revokeEntitlementsForSession(session, env);
  await notifyAllCreators({
    kind: "dispute_opened",
    title: "Payment dispute opened — access frozen",
    body: "Access has been revoked pending the dispute outcome.",
    link_url: "/dashboard",
    metadata: { session_id: session.id, dispute_id: dispute.id, env } as any,
  });
}

/**
 * charge.dispute.closed — if we won, replay the grant path so the buyer
 * gets their access back. Any other outcome (lost, warning_closed) keeps
 * the entitlements revoked.
 */
async function handleDisputeClosed(dispute: any, env: StripeEnv) {
  if (!dispute?.payment_intent) return;
  const session = await findSessionByPaymentIntent(dispute.payment_intent, env);
  if (!session) return;
  if (dispute.status === "won") {
    await handleCheckoutCompleted(session, env);
    await notifyAllCreators({
      kind: "dispute_won",
      title: "Dispute won — access restored",
      body: "The buyer's access has been re-granted.",
      link_url: "/dashboard",
      metadata: { session_id: session.id, dispute_id: dispute.id, env } as any,
    });
  } else {
    await notifyAllCreators({
      kind: "dispute_closed",
      title: `Dispute closed (${dispute.status})`,
      body: "Access remains revoked.",
      link_url: "/dashboard",
      metadata: { session_id: session.id, dispute_id: dispute.id, env } as any,
    });
  }
}

/**
 * Renewal payment failed. Flip the row to `past_due` (access still granted
 * — Stripe will retry over the dunning window), notify the subscriber, and
 * schedule day-3 / day-7 / day-14 escalation emails via the daily cron.
 */
async function handleInvoicePaymentFailed(invoice: any, env: StripeEnv) {
  const subId = invoice.subscription;
  if (!subId || typeof subId !== "string") return;
  const { data: sub } = await getSupabase()
    .from("subscriptions")
    .select("user_id")
    .eq("stripe_subscription_id", subId)
    .eq("environment", env)
    .maybeSingle();
  await getSupabase()
    .from("subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subId)
    .eq("environment", env);
  if (sub?.user_id) {
    await getSupabase().from("notifications").insert({
      user_id: sub.user_id as string,
      kind: "payment_failed",
      title: "Payment failed — update your card",
      body: "Your renewal payment didn't go through. Update your card in Account → Billing to avoid losing access.",
      link_url: "/account/billing",
      metadata: { subscription_id: subId, env } as any,
    });

    // Schedule dunning escalation: day 3 → day 7 → day 14 (final).
    const nextEmailAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    await (getSupabase() as any)
      .from("dunning_schedule")
      .upsert(
        {
          user_id: sub.user_id,
          stripe_invoice_id: invoice.id,
          stripe_subscription_id: subId,
          environment: env,
          stage: "day_3",
          next_email_at: nextEmailAt.toISOString(),
        },
        { onConflict: "stripe_invoice_id" },
      );
  }
}

/**
 * Renewal (or first) invoice paid. Clear any lingering past_due state,
 * cancel dunning schedule for the paid invoice/subscription, and refresh
 * the local `current_period_end` from the invoice's line item so the row
 * stays fresh even when `customer.subscription.updated` lags.
 */
async function handleInvoicePaymentSucceeded(invoice: any, env: StripeEnv) {
  const subId = invoice.subscription;
  if (!subId || typeof subId !== "string") return;

  // Cancel any queued dunning for this subscription — payment landed.
  await (getSupabase() as any)
    .from("dunning_schedule")
    .update({ stage: "canceled", updated_at: new Date().toISOString() })
    .eq("stripe_subscription_id", subId)
    .eq("environment", env)
    .not("stage", "in", "(done,canceled)");

  const line = invoice.lines?.data?.[0];
  const periodEnd = line?.period?.end ?? null;
  const updates: any = { updated_at: new Date().toISOString(), status: "active" };
  if (periodEnd) updates.current_period_end = new Date(periodEnd * 1000).toISOString();

  await getSupabase()
    .from("subscriptions")
    .update(updates)
    .eq("stripe_subscription_id", subId)
    .eq("environment", env);
}

/**
 * customer.subscription.trial_will_end — Stripe fires this ~3 days before
 * a trial ends. Record a notification; the daily dunning cron picks it up
 * and sends the `trial-ending` email once.
 */
async function handleTrialWillEnd(subscription: any, env: StripeEnv) {
  const userId = subscription.metadata?.userId;
  if (!userId) return;
  await getSupabase().from("notifications").insert({
    user_id: userId,
    kind: "trial_ending",
    title: "Your trial ends in 3 days",
    body: "Add or update your card in Account → Billing to continue after your trial.",
    link_url: "/account/billing",
    metadata: { subscription_id: subscription.id, env } as any,
  });
}

/**
 * setup_intent.succeeded — safety net when the customer closes their tab
 * before returning from the setup checkout. If the SetupIntent came from
 * our `update_default_pm` flow, attach the new PM to the customer as
 * default and update any active subscription. Idempotent — a no-op if the
 * PM is already default.
 */
async function handleSetupIntentSucceeded(setupIntent: any, env: StripeEnv) {
  const purpose = setupIntent.metadata?.purpose;
  if (purpose !== "update_default_pm") return;
  const customerId = typeof setupIntent.customer === "string" ? setupIntent.customer : setupIntent.customer?.id;
  const pmId = typeof setupIntent.payment_method === "string" ? setupIntent.payment_method : setupIntent.payment_method?.id;
  if (!customerId || !pmId) return;
  const stripe = createStripeClient(env);
  try {
    const customer = await stripe.customers.retrieve(customerId);
    const currentDefault = !("deleted" in customer) || !customer.deleted
      ? ((customer as any).invoice_settings?.default_payment_method ?? null)
      : null;
    const currentDefaultId = typeof currentDefault === "string" ? currentDefault : currentDefault?.id;
    if (currentDefaultId === pmId) return; // already default — nothing to do

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: pmId },
    });
    // If the customer has any subscription, update its default PM too.
    const subs = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 5 });
    for (const s of subs.data) {
      if (["active", "trialing", "past_due"].includes(s.status)) {
        await stripe.subscriptions.update(s.id, { default_payment_method: pmId });
      }
    }
  } catch (err) {
    console.error("setup_intent.succeeded finalise failed:", err);
  }
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
    case "checkout.session.async_payment_succeeded":
      await handleCheckoutCompleted(event.data.object, env);
      break;
    case "checkout.session.async_payment_failed":
      await handleAsyncPaymentFailed(event.data.object, env);
      break;
    case "invoice.payment_failed":
      await handleInvoicePaymentFailed(event.data.object, env);
      break;
    case "invoice.payment_succeeded":
    case "invoice.paid":
      await handleInvoicePaymentSucceeded(event.data.object, env);
      break;
    case "charge.refunded":
      await handleChargeRefunded(event.data.object, env);
      break;
    case "charge.dispute.created":
      await handleDisputeCreated(event.data.object, env);
      break;
    case "charge.dispute.closed":
      await handleDisputeClosed(event.data.object, env);
      break;
    case "customer.subscription.trial_will_end":
      await handleTrialWillEnd(event.data.object, env);
      break;
    case "setup_intent.succeeded":
      await handleSetupIntentSucceeded(event.data.object, env);
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
