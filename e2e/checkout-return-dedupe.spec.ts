/**
 * Verifies the return-page's per-session dedup contract.
 *
 * `checkout.return.tsx` uses three `useRef` de-duplicators, all keyed by
 * session_id (and event name / template marker where relevant):
 *
 *   - trackedRef        →  panty_checkout_{confirmed,pending,cancelled}
 *   - errorTrackedRef   →  stripe_checkout_return_failed + mirrored cancelled
 *   - attributionRef    →  checkout_completed
 *
 * These tests force the return-page effect to re-run within a single page
 * load — React Query refetch + refocus, and repeat in-router navigation to
 * the same URL — and assert that exactly one event of each expected name is
 * recorded for the given session_id / client_order_ref.
 */

import { test, expect } from "@playwright/test";
import {
  countEvents,
  installTrackCollector,
  mockGetCheckoutSession,
  readEvents,
  waitForEvent,
} from "./_helpers";

const CONFIRMED_SESSION = {
  status: "complete",
  metadata: {
    panty_order: "panty_black_m",
    client_order_ref: "11111111-1111-1111-1111-111111111111",
  },
  session_id: "cs_dedupe_confirmed",
  payment_intent_id: "pi_dedupe_confirmed",
  amount_total: 4500,
  currency: "aud",
  order_ids: ["22222222-2222-2222-2222-222222222222"],
};

const PENDING_SESSION = {
  status: "open",
  metadata: {
    panty_order: "panty_pink_s",
    client_order_ref: "44444444-4444-4444-4444-444444444444",
  },
  session_id: "cs_dedupe_pending",
  payment_intent_id: "pi_dedupe_pending",
  amount_total: 4500,
  currency: "aud",
  order_ids: [],
};

const EXPIRED_SESSION = {
  status: "expired",
  metadata: { panty_order: "panty_red_l" },
  session_id: "cs_dedupe_expired",
  payment_intent_id: null,
  amount_total: null,
  currency: "aud",
  order_ids: [],
};

/**
 * Poke the return page hard enough that the tracking effects would fire
 * again if they weren't deduped:
 *   1. Invalidate every React Query cache entry (forces the session
 *      query to refetch and its consumer effect to re-run with fresh data).
 *   2. Fire window focus + visibilitychange so any refetchOnWindowFocus
 *      handlers wake up.
 *   3. Do it three times, then wait a beat for the events to settle.
 */
async function forceReeffects(page: import("@playwright/test").Page) {
  for (let i = 0; i < 3; i++) {
    await page.evaluate(async () => {
      // TanStack Router stashes the QueryClient on the router context.
      // Reach it through the exposed __TSR_ROUTER__ when present, else
      // fall back to firing focus/visibility, which triggers React Query's
      // default refetchOnWindowFocus.
      const w = window as unknown as {
        __TSR_ROUTER__?: {
          options?: { context?: { queryClient?: { invalidateQueries: () => Promise<void> } } };
        };
      };
      const qc = w.__TSR_ROUTER__?.options?.context?.queryClient;
      if (qc) await qc.invalidateQueries();
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.waitForTimeout(200);
  }
}

test.beforeEach(async ({ page }) => {
  await installTrackCollector(page);
});

test("confirmed: repeat refetches fire panty_checkout_confirmed and checkout_completed only once", async ({
  page,
}) => {
  await mockGetCheckoutSession(page, "return", CONFIRMED_SESSION);

  await page.goto("/checkout/return?session_id=cs_dedupe_confirmed");
  await waitForEvent(page, "panty_checkout_confirmed");
  await waitForEvent(page, "checkout_completed");

  await forceReeffects(page);

  const events = await readEvents(page);
  const confirmed = events.filter((e) => e.name === "panty_checkout_confirmed");
  const completed = events.filter((e) => e.name === "checkout_completed");

  expect(confirmed).toHaveLength(1);
  expect(completed).toHaveLength(1);
  // Dedup is keyed by session_id — the recorded event is the right one.
  expect(confirmed[0].payload.session_id).toBe("cs_dedupe_confirmed");
  expect(confirmed[0].payload.client_order_ref).toBe(
    "11111111-1111-1111-1111-111111111111",
  );
  expect(completed[0].payload.session_id).toBe("cs_dedupe_confirmed");
});

test("pending: repeat refetches fire panty_checkout_pending only once", async ({
  page,
}) => {
  await mockGetCheckoutSession(page, "return", PENDING_SESSION);

  await page.goto("/checkout/return?session_id=cs_dedupe_pending");
  await waitForEvent(page, "panty_checkout_pending");

  await forceReeffects(page);

  const events = await readEvents(page);
  expect(countEvents(events, "panty_checkout_pending")).toBe(1);
  // A pending session must never fire the confirmed / completed events.
  expect(countEvents(events, "panty_checkout_confirmed")).toBe(0);
  expect(countEvents(events, "checkout_completed")).toBe(0);
});

test("expired: repeat refetches fire panty_checkout_cancelled(return_incomplete) only once", async ({
  page,
}) => {
  await mockGetCheckoutSession(page, "return", EXPIRED_SESSION);

  await page.goto("/checkout/return?session_id=cs_dedupe_expired");
  await waitForEvent(page, "panty_checkout_cancelled");

  await forceReeffects(page);

  const events = await readEvents(page);
  const cancelled = events.filter(
    (e) =>
      e.name === "panty_checkout_cancelled" &&
      (e.payload as { reason?: string }).reason === "return_incomplete",
  );
  expect(cancelled).toHaveLength(1);
});

test("missing session template: repeat refetches fire failure events only once", async ({
  page,
}) => {
  await page.goto("/checkout/return?session_id=%7BCHECKOUT_SESSION_ID%7D");
  await waitForEvent(page, "stripe_checkout_return_failed");

  await forceReeffects(page);

  const events = await readEvents(page);
  const failed = events.filter(
    (e) =>
      e.name === "stripe_checkout_return_failed" &&
      (e.payload as { reason?: string }).reason === "missing_session_id",
  );
  const cancelled = events.filter(
    (e) =>
      e.name === "panty_checkout_cancelled" &&
      (e.payload as { reason?: string }).reason === "missing_session_id",
  );
  expect(failed).toHaveLength(1);
  expect(cancelled).toHaveLength(1);
});

test("server error: refetch retries fire session_fetch_error events only once per session", async ({
  page,
}) => {
  await mockGetCheckoutSession(page, "throw", "x".repeat(500));

  await page.goto("/checkout/return?session_id=cs_dedupe_boom");
  await waitForEvent(page, "stripe_checkout_return_failed");

  // Query has retry:2 so refetches themselves may hit the mock several
  // times — the dedup lives above that at the tracking layer.
  await forceReeffects(page);

  const events = await readEvents(page);
  const failed = events.filter(
    (e) =>
      e.name === "stripe_checkout_return_failed" &&
      (e.payload as { reason?: string }).reason === "session_fetch_error" &&
      (e.payload as { session_id?: string }).session_id === "cs_dedupe_boom",
  );
  const cancelled = events.filter(
    (e) =>
      e.name === "panty_checkout_cancelled" &&
      (e.payload as { reason?: string }).reason === "session_fetch_error" &&
      (e.payload as { session_id?: string }).session_id === "cs_dedupe_boom",
  );
  expect(failed).toHaveLength(1);
  expect(cancelled).toHaveLength(1);
});
