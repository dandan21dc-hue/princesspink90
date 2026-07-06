import { describe, expect, it } from "vitest";
import {
  buildPantyReturnErrorEvents,
  buildPantyReturnEvent,
  buildPantyStartEvent,
  type CheckoutSessionResult,
} from "./pantyCheckoutEvents";

// End-to-end coverage of the panty_checkout_* funnel events. Each test drives
// the exact builder used by src/components/CartDrawer.tsx (start) and
// src/routes/checkout.return.tsx (confirmed / pending / cancelled) and
// asserts that the reconciliation fields (session_id, payment_intent_id,
// order_id, order_ids, order_count, client_order_ref) surface as documented
// in docs/analytics/panty-checkout-events.md.

const SESSION_ID = "cs_test_9f8g7h6j5k";
const PI_ID = "pi_test_abc123";
const ORDER_ID_A = "11111111-1111-1111-1111-111111111111";
const ORDER_ID_B = "22222222-2222-2222-2222-222222222222";
const CLIENT_ORDER_REF = "co_ref_xyz";

function baseSession(
  overrides: Partial<CheckoutSessionResult> = {},
): CheckoutSessionResult {
  return {
    session_id: SESSION_ID,
    status: "complete",
    payment_intent_id: PI_ID,
    amount_total: 12000,
    currency: "aud",
    metadata: {
      panty_order: "panty_24h_aud",
      client_order_ref: CLIENT_ORDER_REF,
    },
    order_ids: [ORDER_ID_A],
    ...overrides,
  };
}

describe("panty_checkout_start (cart drawer)", () => {
  it("carries client_order_ref, subtotal, and item metadata for reconciliation", () => {
    const evt = buildPantyStartEvent({
      items: [
        {
          kind: "panty",
          id: "panty_24h_aud",
          title: "24h Wear",
          quantity: 2,
          unit_amount_cents: 6000,
          currency: "aud",
        },
        {
          kind: "content",
          id: "clip_1",
          title: "Clip",
          quantity: 1,
          unit_amount_cents: 3000,
          currency: "aud",
        },
      ],
      clientOrderRef: CLIENT_ORDER_REF,
      currency: "aud",
    });

    expect(evt.name).toBe("panty_checkout_start");
    expect(evt.payload).toMatchObject({
      source: "cart",
      client_order_ref: CLIENT_ORDER_REF,
      item_count: 2,
      unit_count: 3,
      subtotal_cents: 15000,
      total_amount_cents: 15000,
      currency: "aud",
      has_panty: true,
    });
    expect(typeof evt.payload.items).toBe("string");
    const parsed = JSON.parse(evt.payload.items as string);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({ kind: "panty", quantity: 2 });
  });
});

describe("panty_checkout return-page events", () => {
  it("emits panty_checkout_confirmed with order_id + order_ids when status = complete", () => {
    const evt = buildPantyReturnEvent(baseSession(), SESSION_ID);
    expect(evt).not.toBeNull();
    expect(evt!.name).toBe("panty_checkout_confirmed");
    expect(evt!.payload).toMatchObject({
      variant: "panty_24h_aud",
      session_id: SESSION_ID,
      payment_intent_id: PI_ID,
      client_order_ref: CLIENT_ORDER_REF,
      order_id: ORDER_ID_A,
      order_ids: ORDER_ID_A,
      order_count: 1,
      total_amount_cents: 12000,
      currency: "aud",
      status: "complete",
      cart_mode: false,
    });
  });

  it("joins multiple panty_orders in cart mode as comma-separated order_ids", () => {
    const evt = buildPantyReturnEvent(
      baseSession({
        metadata: {
          cart_panty_items: "2",
          cart_mode: "1",
          client_order_ref: CLIENT_ORDER_REF,
        },
        order_ids: [ORDER_ID_A, ORDER_ID_B],
      }),
      SESSION_ID,
    );
    expect(evt!.name).toBe("panty_checkout_confirmed");
    expect(evt!.payload).toMatchObject({
      variant: "cart",
      cart_mode: true,
      order_id: ORDER_ID_A,
      order_ids: `${ORDER_ID_A},${ORDER_ID_B}`,
      order_count: 2,
    });
  });

  it("emits panty_checkout_pending with order_count 0 when webhook hasn't landed yet", () => {
    const evt = buildPantyReturnEvent(
      baseSession({ status: "open", order_ids: [] }),
      SESSION_ID,
    );
    expect(evt!.name).toBe("panty_checkout_pending");
    expect(evt!.payload).toMatchObject({
      status: "open",
      session_id: SESSION_ID,
      payment_intent_id: PI_ID,
      client_order_ref: CLIENT_ORDER_REF,
      order_count: 0,
    });
    // no order rows yet → both order_id and order_ids should be absent
    expect(evt!.payload.order_id).toBeUndefined();
    expect(evt!.payload.order_ids).toBeUndefined();
  });

  it("emits panty_checkout_cancelled with return_incomplete when status is neither complete nor open", () => {
    const evt = buildPantyReturnEvent(
      baseSession({ status: "expired", payment_intent_id: null }),
      SESSION_ID,
    );
    expect(evt!.name).toBe("panty_checkout_cancelled");
    expect(evt!.payload).toMatchObject({
      source: "checkout_return",
      reason: "return_incomplete",
      stage: "post_return",
      session_id: SESSION_ID,
      status: "expired",
      order_id: ORDER_ID_A,
      order_count: 1,
    });
    expect(evt!.payload.payment_intent_id).toBeUndefined();
  });

  it("returns null for non-panty sessions so nothing is emitted", () => {
    const evt = buildPantyReturnEvent(
      baseSession({ metadata: { membership: "lifetime" } }),
      SESSION_ID,
    );
    expect(evt).toBeNull();
  });
});

describe("panty_checkout return-page error paths", () => {
  it("emits missing_session_id pair when Stripe returned the placeholder template", () => {
    const events = buildPantyReturnErrorEvents({
      templateNotSubstituted: true,
      sessionId: undefined,
    });
    expect(events.map((e) => e.name)).toEqual([
      "stripe_checkout_return_failed",
      "panty_checkout_cancelled",
    ]);
    expect(events[0].payload).toEqual({ reason: "missing_session_id" });
    expect(events[1].payload).toMatchObject({
      source: "checkout_return",
      reason: "missing_session_id",
      stage: "post_return",
    });
    // No session id available — must not fabricate one.
    expect(events[1].payload.session_id).toBeUndefined();
  });

  it("emits session_fetch_error pair carrying session_id and truncated message", () => {
    const long = "x".repeat(500);
    const events = buildPantyReturnErrorEvents({
      templateNotSubstituted: false,
      sessionId: SESSION_ID,
      errorMessage: long,
    });
    expect(events.map((e) => e.name)).toEqual([
      "stripe_checkout_return_failed",
      "panty_checkout_cancelled",
    ]);
    expect(events[0].payload).toMatchObject({
      reason: "session_fetch_error",
      session_id: SESSION_ID,
    });
    expect((events[0].payload.message as string).length).toBe(200);
    expect(events[1].payload).toMatchObject({
      source: "checkout_return",
      reason: "session_fetch_error",
      stage: "post_return",
      session_id: SESSION_ID,
    });
  });

  it("emits nothing when sessionId is missing but the template resolved", () => {
    expect(
      buildPantyReturnErrorEvents({
        templateNotSubstituted: false,
        sessionId: undefined,
      }),
    ).toEqual([]);
  });
});
