/**
 * End-to-end coverage for the cart checkout page's subscriber-discount
 * surface. Mocks `getSubscriberStatus` (and stubs `createCartCheckoutSession`
 * plus Supabase auth) so we can render each remaining-allowance state
 * deterministically and assert:
 *   - the discounted-price math in the order summary
 *   - the "N of 3 remaining" / progress-bar copy
 *   - the warning/last/exhausted messaging as the cart contents change
 *   - the post-limit behavior when the allowance is fully spent
 */

import { test, expect, type Page, type Route } from "@playwright/test";
import { encodeServerFnResponse } from "./_helpers";

type PantyItem = {
  kind: "panty";
  id: "panty_24hr_aud" | "panty_48hr_aud" | "panty_72hr_aud";
  title: string;
  unit_amount_cents: number;
  currency: string;
  quantity: number;
  size?: string;
};

function decodeServerFnName(url: URL): string | null {
  const seg = url.pathname.split("/_serverFn/")[1];
  if (!seg) return null;
  try {
    return atob(seg);
  } catch {
    return null;
  }
}

type SubStatus = {
  isSubscriber: boolean;
  discountPercent: number;
  discountedOrdersRemaining: number;
  discountedOrdersMax: number;
};

async function stubBackend(page: Page, status: SubStatus) {
  // Fake an authenticated Supabase user so the page doesn't bounce to /auth.
  await page.route("**/auth/v1/user**", async (route: Route) => {
    return route.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: "00000000-0000-0000-0000-000000000001",
        aud: "authenticated",
        role: "authenticated",
        email: "test@example.com",
      }),
    });
  });

  // Cloudflare trace lookup for country detection — return an empty body
  // so the checkout doesn't hang waiting on the real network.
  await page.route("https://www.cloudflare.com/cdn-cgi/trace", (route) =>
    route.fulfill({ status: 200, body: "loc=AU\n" }),
  );

  await page.route("**/_serverFn/*", async (route: Route) => {
    const name = decodeServerFnName(new URL(route.request().url()));
    if (!name) return route.fallback();
    if (name.includes("getSubscriberStatus")) {
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-tss-serialized": "true",
        },
        body: encodeServerFnResponse(status),
      });
    }
    if (name.includes("createCartCheckoutSession")) {
      // Return a benign "no client secret" so the Stripe iframe never
      // mounts. The order-summary aside still renders — that's what we
      // assert on.
      return route.fulfill({
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-tss-serialized": "true",
        },
        body: encodeServerFnResponse({ clientSecret: null }),
      });
    }
    return route.fallback();
  });
}

async function seedCart(page: Page, items: PantyItem[]) {
  await page.addInitScript((payload) => {
    try {
      window.localStorage.setItem("pp_cart_v1", payload);
    } catch {
      /* ignore */
    }
  }, JSON.stringify(items));
}

const PANTY_24: PantyItem = {
  kind: "panty",
  id: "panty_24hr_aud",
  title: "24-hour panty",
  unit_amount_cents: 10000,
  currency: "aud",
  quantity: 1,
  size: "M",
};

test("subscriber with 3 remaining, 1-item cart → 15% off applied, 2 left after", async ({
  page,
}) => {
  await stubBackend(page, {
    isSubscriber: true,
    discountPercent: 15,
    discountedOrdersRemaining: 3,
    discountedOrdersMax: 3,
  });
  await seedCart(page, [PANTY_24]);
  await page.goto("/checkout/cart");

  const aside = page.locator("aside");
  await expect(aside.getByText("Subscriber 15% off", { exact: false })).toBeVisible();
  await expect(aside.getByText("Active")).toBeVisible();
  // "3 / 3" remaining count.
  await expect(aside.getByText(/^\s*3\s*\/\s*3\s*$/)).toBeVisible();
  // Discount math: 15% of A$100 = A$15.
  await expect(aside.getByText(/Subscriber discount \(15%\)/)).toBeVisible();
  await expect(aside.getByText("−A$15")).toBeVisible();
  await expect(aside.getByText("Estimated total")).toBeVisible();
  await expect(aside.getByText("A$85")).toBeVisible();
  // FAQ-style copy: 2 discounted orders left after this purchase.
  await expect(
    aside.getByText(/After this order you'll have\s*2\s*discounted orders? left/),
  ).toBeVisible();
});

test("subscriber with 1 remaining, 1-item cart → 'last discounted order' warning", async ({
  page,
}) => {
  await stubBackend(page, {
    isSubscriber: true,
    discountPercent: 15,
    discountedOrdersRemaining: 1,
    discountedOrdersMax: 3,
  });
  await seedCart(page, [PANTY_24]);
  await page.goto("/checkout/cart");

  const aside = page.locator("aside");
  await expect(aside.getByText(/^\s*1\s*\/\s*3\s*$/)).toBeVisible();
  await expect(aside.getByText("Last discount")).toBeVisible();
  await expect(
    aside.getByText(/This is your last discounted order/),
  ).toBeVisible();
  // Discount still applied on the last one.
  await expect(aside.getByText("−A$15")).toBeVisible();
});

test("cart exceeds remaining allowance → 'only N items qualify' partial-coverage warning", async ({
  page,
}) => {
  await stubBackend(page, {
    isSubscriber: true,
    discountPercent: 15,
    discountedOrdersRemaining: 1,
    discountedOrdersMax: 3,
  });
  await seedCart(page, [{ ...PANTY_24, quantity: 2 }]);
  await page.goto("/checkout/cart");

  const aside = page.locator("aside");
  await expect(
    aside.getByText(
      /Only 1 item in this cart qualify — Stripe will apply the 15% to those and charge the rest at full price\./,
    ),
  ).toBeVisible();
});

test("subscriber post-limit (0 remaining) → discount not applied, full price charged", async ({
  page,
}) => {
  await stubBackend(page, {
    isSubscriber: true,
    discountPercent: 15,
    discountedOrdersRemaining: 0,
    discountedOrdersMax: 3,
  });
  await seedCart(page, [PANTY_24]);
  await page.goto("/checkout/cart");

  const aside = page.locator("aside");
  await expect(aside.getByText("Used up")).toBeVisible();
  await expect(aside.getByText(/^\s*0\s*\/\s*3\s*$/)).toBeVisible();
  await expect(
    aside.getByText(/Not applied · 3\/3 discounted orders used/),
  ).toBeVisible();
  await expect(
    aside.getByText(
      /You've used all 3 subscriber-discount Panty Drawer orders\. This order is charged at full price\./,
    ),
  ).toBeVisible();
  // No discount line item / no estimated-total block.
  await expect(aside.getByText("−A$15")).toHaveCount(0);
  await expect(aside.getByText("Estimated total")).toHaveCount(0);
});

test("non-subscriber with panty in cart → subscribe-to-unlock CTA, no discount", async ({
  page,
}) => {
  await stubBackend(page, {
    isSubscriber: false,
    discountPercent: 0,
    discountedOrdersRemaining: 0,
    discountedOrdersMax: 3,
  });
  await seedCart(page, [PANTY_24]);
  await page.goto("/checkout/cart");

  const aside = page.locator("aside");
  await expect(aside.getByText(/Subscribers save 15%/)).toBeVisible();
  await expect(aside.getByRole("link", { name: /Subscribe to unlock/ })).toBeVisible();
  await expect(aside.getByText(/Not applied · Subscribers only/)).toBeVisible();
  await expect(aside.getByText("Estimated total")).toHaveCount(0);
});
