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
import { toCrossJSON } from "seroval";

type TrackedEvent = { name: string; payload: Record<string, unknown> };

// Server-fn ids are `btoa(JSON.stringify({file, export}))`. We only care
// about matching the getCheckoutSession call — other server functions
// invoked by the page (analytics logging, tier reads) must fall through
// to the real dev server so React Query doesn't stall.
function isGetCheckoutSessionUrl(url: URL): boolean {
  const seg = url.pathname.split("/_serverFn/")[1];
  if (!seg) return false;
  try {
    return atob(seg).includes("getCheckoutSession");
  } catch {
    return false;
  }
}

async function installTrackCollector(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __events: TrackedEvent[] }).__events = [];
    window.addEventListener("app:track", (e: Event) => {
      const detail = (e as CustomEvent<Record<string, unknown>>).detail;
      const { event, ...payload } = detail as { event: string } & Record<
        string,
        unknown
      >;
      (window as unknown as { __events: TrackedEvent[] }).__events.push({
        name: event,
        payload,
      });
    });
  });
}

/**
 * Encode a mock server-fn response in the exact shape TanStack Start's
 * client fetcher expects: `x-tss-serialized: true`, JSON body wrapping
 * `{result, error, context}` via seroval's `toCrossJSON`.
 */
function encodeServerFnResponse(result: unknown): string {
  return JSON.stringify(
    toCrossJSON({ result, error: undefined, context: undefined }),
  );
}

async function mockGetCheckoutSession(
  page: Page,
  behaviour: "return" | "throw",
  result: unknown,
) {
  await page.route("**/_serverFn/*", async (route: Route) => {
    const url = new URL(route.request().url());
    if (!isGetCheckoutSessionUrl(url)) return route.fallback();
    if (behaviour === "throw") {
      return route.fulfill({ status: 500, body: String(result) });
    }
    return route.fulfill({
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-tss-serialized": "true",
      },
      body: encodeServerFnResponse(result),
    });
  });
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
  await mockGetCheckoutSession(page, "return", {
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
  });

  await page.goto("/checkout/return?session_id=cs_test_confirmed");
  await waitForEvent(page, "panty_checkout_confirmed");

  const confirmed = (await readEvents(page)).find(
    (e) => e.name === "panty_checkout_confirmed",
  )!;
  expect(confirmed.payload).toMatchObject({
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

  // Same event mirrors into the GTM dataLayer under `event`.
  const dl = await page.evaluate(
    () =>
      (window as unknown as { dataLayer: Record<string, unknown>[] })
        .dataLayer,
  );
  expect(dl.some((r) => r.event === "panty_checkout_confirmed")).toBe(true);
});

test("confirmed cart checkout → order_ids joined, order_count matches split length", async ({
  page,
}) => {
  await mockGetCheckoutSession(page, "return", {
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
  const ids = String(confirmed.payload.order_ids).split(",");
  expect(ids.length).toBe(confirmed.payload.order_count);
});

test("pending panty checkout → panty_checkout_pending, order_count=0, no order_id", async ({
  page,
}) => {
  await mockGetCheckoutSession(page, "return", {
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
  // Null/undefined fields are stripped by track() before dispatch.
  expect(pending.payload.order_id).toBeUndefined();
  expect(pending.payload.order_ids).toBeUndefined();
});

test("incomplete/expired panty checkout → panty_checkout_cancelled(return_incomplete)", async ({
  page,
}) => {
  await mockGetCheckoutSession(page, "return", {
    status: "expired",
    metadata: { panty_order: "panty_red_l" },
    session_id: "cs_test_expired",
    payment_intent_id: null,
    amount_total: null,
    currency: "aud",
    order_ids: [],
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
  // No server-fn mock needed — the guard fires before any fetch.
  await page.goto("/checkout/return?session_id=%7BCHECKOUT_SESSION_ID%7D");
  await waitForEvent(page, "stripe_checkout_return_failed");

  const events = await readEvents(page);
  const failed = events.find(
    (e) => e.name === "stripe_checkout_return_failed",
  )!;
  expect(failed.payload).toMatchObject({ reason: "missing_session_id" });
  expect(failed.payload.session_id).toBeUndefined();

  const cancelled = events.find((e) => e.name === "panty_checkout_cancelled")!;
  expect(cancelled.payload).toMatchObject({
    source: "checkout_return",
    reason: "missing_session_id",
    stage: "post_return",
  });
});

test("server error fetching session → session_fetch_error + cancelled, message truncated to 200 chars", async ({
  page,
}) => {
  const longMessage = "x".repeat(500);
  await mockGetCheckoutSession(page, "throw", longMessage);

  await page.goto("/checkout/return?session_id=cs_test_boom");
  await waitForEvent(page, "stripe_checkout_return_failed");

  const events = await readEvents(page);
  const failed = events.find(
    (e) => e.name === "stripe_checkout_return_failed",
  )!;
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
