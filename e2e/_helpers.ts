import type { Page, Route } from "@playwright/test";
import { toCrossJSON } from "seroval";

export type TrackedEvent = { name: string; payload: Record<string, unknown> };

// Server-fn ids are `btoa(JSON.stringify({file, export}))`. We only care
// about matching the getCheckoutSession call — other server functions
// invoked by the page (analytics logging, tier reads) must fall through
// to the real dev server so React Query doesn't stall.
export function isGetCheckoutSessionUrl(url: URL): boolean {
  const seg = url.pathname.split("/_serverFn/")[1];
  if (!seg) return false;
  try {
    return atob(seg).includes("getCheckoutSession");
  } catch {
    return false;
  }
}

export async function installTrackCollector(page: Page) {
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
export function encodeServerFnResponse(result: unknown): string {
  return JSON.stringify(
    toCrossJSON({ result, error: undefined, context: undefined }),
  );
}

export async function mockGetCheckoutSession(
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

export async function readEvents(page: Page): Promise<TrackedEvent[]> {
  return page.evaluate(
    () => (window as unknown as { __events: TrackedEvent[] }).__events,
  );
}

export async function waitForEvent(
  page: Page,
  name: string,
  timeout = 20_000,
) {
  await page.waitForFunction(
    (n) =>
      (window as unknown as { __events: { name: string }[] }).__events.some(
        (e) => e.name === n,
      ),
    name,
    { timeout },
  );
}

export function countEvents(events: TrackedEvent[], name: string): number {
  return events.filter((e) => e.name === name).length;
}
