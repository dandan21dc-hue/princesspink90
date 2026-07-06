// Pure builders for the panty_checkout_* analytics events emitted by the
// cart drawer and the Stripe return page. Extracted so they can be unit
// tested end-to-end without rendering React or hitting Stripe.
//
// See docs/analytics/panty-checkout-events.md for the full payload schema.

export type TrackPayload = Record<string, string | number | boolean | null | undefined>;

export type CartLine = {
  kind: string;
  id: string;
  title: string;
  quantity: number;
  unit_amount_cents: number;
  currency: string;
};

export function buildPantyStartEvent(input: {
  items: CartLine[];
  clientOrderRef: string;
  currency: string;
}): { name: "panty_checkout_start"; payload: TrackPayload } {
  const { items, clientOrderRef, currency } = input;
  const subtotalCents = items.reduce(
    (n, it) => n + it.unit_amount_cents * it.quantity,
    0,
  );
  const unitCount = items.reduce((n, it) => n + it.quantity, 0);
  const hasPanty = items.some((it) => it.kind === "panty");
  return {
    name: "panty_checkout_start",
    payload: {
      source: "cart",
      client_order_ref: clientOrderRef,
      item_count: items.length,
      unit_count: unitCount,
      subtotal_cents: subtotalCents,
      total_amount_cents: subtotalCents,
      currency,
      has_panty: hasPanty,
      items: JSON.stringify(items),
    },
  };
}

export type CheckoutSessionResult = {
  status: string | null;
  metadata: Record<string, string> | null;
  session_id: string;
  payment_intent_id: string | null;
  amount_total: number | null;
  currency: string | null;
  order_ids?: string[];
};

export type PantyReturnEvent =
  | { name: "panty_checkout_confirmed"; payload: TrackPayload }
  | { name: "panty_checkout_pending"; payload: TrackPayload }
  | { name: "panty_checkout_cancelled"; payload: TrackPayload };

/**
 * Compute the tracking event for a Stripe return-page load. Returns `null`
 * when the session is not a panty checkout (nothing should fire).
 */
export function buildPantyReturnEvent(
  session: CheckoutSessionResult,
  sessionId: string,
): PantyReturnEvent | null {
  const md = session.metadata ?? {};
  const pantyVariant = md.panty_order || (md.cart_panty_items ? "cart" : null);
  if (!pantyVariant) return null;
  const status = session.status ?? "unknown";
  const orderIds = session.order_ids ?? [];
  const base: TrackPayload = {
    variant: pantyVariant,
    session_id: sessionId,
    payment_intent_id: session.payment_intent_id ?? undefined,
    client_order_ref: md.client_order_ref ?? undefined,
    order_id: orderIds[0] ?? undefined,
    order_ids: orderIds.length > 0 ? orderIds.join(",") : undefined,
    order_count: orderIds.length,
    total_amount_cents: session.amount_total ?? undefined,
    currency: session.currency ?? undefined,
    status,
    cart_mode: md.cart_mode === "1",
  };
  if (status === "complete") {
    return { name: "panty_checkout_confirmed", payload: base };
  }
  if (status === "open") {
    return { name: "panty_checkout_pending", payload: base };
  }
  return {
    name: "panty_checkout_cancelled",
    payload: {
      ...base,
      source: "checkout_return",
      reason: "return_incomplete",
      stage: "post_return",
    },
  };
}

/**
 * Return-page error paths (bad session_id template from Stripe, or the
 * server-side session fetch errored). Emits one or two events — always a
 * `stripe_checkout_return_failed` diagnostic and a mirrored
 * `panty_checkout_cancelled` so funnel analytics stay complete.
 */
export function buildPantyReturnErrorEvents(input: {
  templateNotSubstituted: boolean;
  sessionId: string | undefined;
  errorMessage?: string;
}): Array<{ name: string; payload: TrackPayload }> {
  if (input.templateNotSubstituted) {
    return [
      { name: "stripe_checkout_return_failed", payload: { reason: "missing_session_id" } },
      {
        name: "panty_checkout_cancelled",
        payload: {
          source: "checkout_return",
          reason: "missing_session_id",
          stage: "post_return",
        },
      },
    ];
  }
  if (!input.sessionId) return [];
  return [
    {
      name: "stripe_checkout_return_failed",
      payload: {
        reason: "session_fetch_error",
        session_id: input.sessionId,
        message: input.errorMessage?.slice(0, 200),
      },
    },
    {
      name: "panty_checkout_cancelled",
      payload: {
        source: "checkout_return",
        reason: "session_fetch_error",
        stage: "post_return",
        session_id: input.sessionId,
      },
    },
  ];
}
