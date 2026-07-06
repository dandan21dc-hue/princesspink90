/**
 * End-to-end coverage for the Stripe return page's analytics contract.
 *
 * These tests intercept the `getCheckoutSession` TanStack server function
 * so the page renders each terminal state deterministically without hitting
 * Stripe, and assert the exact `dataLayer` / `app:track` payloads the
 * `panty_checkout_*` funnel depends on.
 *
 * Scenarios:
 *   1. confirmed  — status=complete, single order, panty_checkout_confirmed
 *   2. confirmed cart — status=complete, multi-order cart, order_ids joined
 *   3. pending    — status=open, panty_checkout_pending, order_count=0
 *   4. cancelled  — status=expired, panty_checkout_cancelled (return_incomplete)
 *   5. missing session — template not substituted, stripe_checkout_return_failed
 *   6. server error — server fn throws, session_fetch_error + cancelled
 */

import { test, expect, type Page, type Route } from "@playwright/test";

type TrackedEvent = { name: string; payload: Record<string, unknown> };

// Encoded server-function id used by TanStack Start's transport. The id is
// a base64 of {"file":"/src/lib/store.functions.ts...","export":"getCheckoutSession_..."}.
// We match by substring so we don't have to reproduce the exact digest.
const SERVER_FN_MATCH = "/_serverFn/";

async function installTrackCollector(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __events: TrackedEvent[] }).__events = [];
    window.addEventListener("app:track", (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail;
      const { event, ...payload } = detail as { event: string } & Record<string, unknown>;
      (window as unknown as { __events: TrackedEvent[] }).__events.push({
        name: event,
        payload,
      });
    });
  });
}

async function mockCheckoutSession(
  page: Page,
  respond: (fnName: string) => unknown | null,
) {
  await page.route(
    (url) => url.pathname.includes(SERVER_FN_MATCH),
    async (route: Route) => {
      const req = route.request();
      // The server-fn id is base64 in the URL. Decode enough of it to route.
      const url = new URL(req.url());
      const idSegment = url.pathname.split("/_serverFn/")[1] ?? "";
      let fnName = "";
      try {
        const decoded = atob(idSegment);
        fnName = decoded;
      } catch {
        fnName = idSegment;
      }
      const body = respond(fnName);
      if (body === null) {
        return route.fulfill({ status: 500, body: "boom" });
      }
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        // TanStack Start server-fn transport wraps the return value under
        // { result: { ... }, context: {} } — but the client also accepts a
        // raw JSON body of the returned value. Return the raw body directly.
        body: JSON.stringify(body),
      });
    },
  );
}

async function readEvents(page: Page): Promise<TrackedEvent[]> {
  return page.evaluate(
    () => (window as unknown as { __events: TrackedEvent[] }).__events,
  );
}

async function waitForEvent(page: Page, name: string) {
  await page.waitForFunction(
    (n) =>
      (window as unknown as { __events: { name: string }[] }).__events.some(
        (e) => e.name === n,
      ),
    name,
    { timeout: 10_000 },
  );
}

test.beforeEach(async ({ page }) => {
  await installTrackCollector(page);
});

test("confirmed panty checkout → panty_checkout_confirmed with reconciliation fields", async ({
  page,
}) => {
  await mockCheckoutSession(page, (fn) => {
    if (!fn.includes("getCheckoutSession")) return null;
    return {
      status: "complete",
      metadata: {
        panty_order: "panty_black_m",
        client_order_ref: "11111111-1111-1111-1111-111111111111",
      },
      session_id: "cs_test_confirmed",
      payment_intent_id: "pi_test_confirmed",
      amount_total: 4500,
      currency: "aud",
      order_ids: ["22222222-2222-2222-2222-222222222222"],
    };
  });

  await page.goto("/checkout/return?session_id=cs_test_confirmed");
  await waitForEvent(page, "panty_checkout_confirmed");

  const events = await readEvents(page);
  const confirmed = events.find((e) => e.name === "panty_checkout_confirmed");
  expect(confirmed).toBeDefined();
  expect(confirmed!.payload).toMatchObject({
    variant: "panty_black_m",
    session_id: "cs_test_confirmed",
    payment_intent_id: "pi_test_confirmed",
    client_order_ref: "11111111-1111-1111-1111-111111111111",
    order_id: "22222222-2222-2222-2222-222222222222",
    order_ids: "22222222-2222-2222-2222-222222222222",
    order_count: 1,
    total_amount_cents: 4500,
    currency: "aud",
    status: "complete",
    cart_mode: false,
  });

  // Mirrors into GTM dataLayer with the same event name.
  const dl = await page.evaluate(
    () => (window as unknown as { dataLayer: Record<string, unknown>[] }).dataLayer,
  );
  expect(dl.some((r) => r.event === "panty_checkout_confirmed")).toBe(true);
});

test("confirmed cart checkout → order_ids joined, order_count matches", async ({
  page,
}) => {
  await mockCheckoutSession(page, (fn) => {
    if (!fn.includes("getCheckoutSession")) return null;
    return {
      status: "complete",
      metadata: {
        cart_panty_items: "2",
        cart_mode: "1",
        client_order_ref: "33333333-3333-3333-3333-333333333333",
      },
      session_id: "cs_test_cart",
      payment_intent_id: "pi_test_cart",
      amount_total: 9000,
      currency: "aud",
      order_ids: [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      ],
    };
  });

  await page.goto("/checkout/return?session_id=cs_test_cart");
  await waitForEvent(page, "panty_checkout_confirmed");

  const confirmed = (await readEvents(page)).find(
    (e) => e.name === "panty_checkout_confirmed",
  )!;
  expect(confirmed.payload.variant).toBe("cart");
  expect(confirmed.payload.order_ids).toBe(
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa,bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  );
  expect(confirmed.payload.order_count).toBe(2);
  expect(confirmed.payload.cart_mode).toBe(true);
  // Contract: when both are present, count === ids.split(",").length.
  const ids = String(confirmed.payload.order_ids).split(",");
  expect(ids.length).toBe(confirmed.payload.order_count);
});

test("pending panty checkout → panty_checkout_pending, order_count=0", async ({
  page,
}) => {
  await mockCheckoutSession(page, (fn) => {
    if (!fn.includes("getCheckoutSession")) return null;
    return {
      status: "open",
      metadata: {
        panty_order: "panty_pink_s",
        client_order_ref: "44444444-4444-4444-4444-444444444444",
      },
      session_id: "cs_test_pending",
      payment_intent_id: "pi_test_pending",
      amount_total: 4500,
      currency: "aud",
      order_ids: [],
    };
  });

  await page.goto("/checkout/return?session_id=cs_test_pending");
  await waitForEvent(page, "panty_checkout_pending");

  const pending = (await readEvents(page)).find(
    (e) => e.name === "panty_checkout_pending",
  )!;
  expect(pending.payload).toMatchObject({
    variant: "panty_pink_s",
    session_id: "cs_test_pending",
    payment_intent_id: "pi_test_pending",
    client_order_ref: "44444444-4444-4444-4444-444444444444",
    order_count: 0,
    status: "open",
  });
  expect(pending.payload.order_id).toBeUndefined();
  expect(pending.payload.order_ids).toBeUndefined();
});

test("incomplete/expired panty checkout → panty_checkout_cancelled(return_incomplete)", async ({
  page,
}) => {
  await mockCheckoutSession(page, (fn) => {
    if (!fn.includes("getCheckoutSession")) return null;
    return {
      status: "expired",
      metadata: { panty_order: "panty_red_l" },
      session_id: "cs_test_expired",
      payment_intent_id: null,
      amount_total: null,
      currency: "aud",
      order_ids: [],
    };
  });

  await page.goto("/checkout/return?session_id=cs_test_expired");
  await waitForEvent(page, "panty_checkout_cancelled");

  const cancelled = (await readEvents(page)).find(
    (e) => e.name === "panty_checkout_cancelled",
  )!;
  expect(cancelled.payload).toMatchObject({
    variant: "panty_red_l",
    session_id: "cs_test_expired",
    status: "expired",
    source: "checkout_return",
    reason: "return_incomplete",
    stage: "post_return",
    order_count: 0,
  });
});

test("missing session_id template → stripe_checkout_return_failed + cancelled(missing_session_id)", async ({
  page,
}) => {
  await page.goto("/checkout/return?session_id=%7BCHECKOUT_SESSION_ID%7D");
  await waitForEvent(page, "stripe_checkout_return_failed");

  const events = await readEvents(page);
  const failed = events.find((e) => e.name === "stripe_checkout_return_failed")!;
  expect(failed.payload).toMatchObject({ reason: "missing_session_id" });
  expect(failed.payload.session_id).toBeUndefined();

  const cancelled = events.find((e) => e.name === "panty_checkout_cancelled")!;
  expect(cancelled.payload).toMatchObject({
    source: "checkout_return",
    reason: "missing_session_id",
    stage: "post_return",
  });
});

test("server error fetching session → session_fetch_error + cancelled, message truncated", async ({
  page,
}) => {
  const longMessage = "x".repeat(500);
  await mockCheckoutSession(page, (fn) => {
    if (!fn.includes("getCheckoutSession")) return null;
    // Server-fn error shape the route handler surfaces as thrown Error.
    return { error: longMessage };
  });

  await page.goto("/checkout/return?session_id=cs_test_boom");
  await waitForEvent(page, "stripe_checkout_return_failed");

  const events = await readEvents(page);
  const failed = events.find((e) => e.name === "stripe_checkout_return_failed")!;
  expect(failed.payload).toMatchObject({
    reason: "session_fetch_error",
    session_id: "cs_test_boom",
  });
  expect(String(failed.payload.message).length).toBeLessThanOrEqual(200);

  const cancelled = events.find(
    (e) =>
      e.name === "panty_checkout_cancelled" &&
      (e.payload as { reason?: string }).reason === "session_fetch_error",
  )!;
  expect(cancelled.payload).toMatchObject({
    source: "checkout_return",
    reason: "session_fetch_error",
    stage: "post_return",
    session_id: "cs_test_boom",
  });
});
