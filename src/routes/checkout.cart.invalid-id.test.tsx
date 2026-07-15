// @vitest-environment jsdom
/**
 * Integration test: cart checkout blocks non-UUID panty listing ids.
 *
 * The cart's own `read()` filter drops legacy/tampered ids on load, but a
 * mid-session race (cross-tab write, direct localStorage tampering) could
 * still surface a panty cart line whose id isn't a UUID. In that case the
 * "Pay with crypto" button MUST:
 *   1. Fire the `toast.error("This item can't be checked out", …)` warning
 *      so the admin knows exactly what to do (remove + re-add).
 *   2. NOT invoke `openCheckout` — sending a non-UUID `pantyListingId` to
 *      the NOWPayments Edge Function is guaranteed to fail with a generic
 *      Zod rejection that leaks no context back to the user.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, within } from "@testing-library/react";

// Router: stub Link/useNavigate so the route mounts headless.
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    createFileRoute: () => (opts: unknown) => opts,
    Link: ({
      to,
      children,
      className,
    }: {
      to: string;
      children: React.ReactNode;
      className?: string;
    }) => (
      <a href={typeof to === "string" ? to : "#"} className={className}>
        {children}
      </a>
    ),
    useNavigate: () => () => {},
  };
});

// Supabase: pretend a user is signed in so the route doesn't bounce to /auth.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1", email: "u@example.com" } },
      }),
    },
  },
}));

// Cart: reuse the REAL `isCartItemIdValid` (that's the code under test) but
// stub `useCart` / `cartStore.snapshot` so we can inject a bad-id line that
// the localStorage read filter would otherwise strip on load.
const { BAD_PANTY_ITEM, GOOD_PANTY_ITEM } = vi.hoisted(() => ({
  BAD_PANTY_ITEM: {
    kind: "panty" as const,
    id: "panty_24hr_aud", // legacy Stripe lookup key, NOT a UUID
    title: "24-hour worn cotton",
    unit_amount_cents: 5900,
    currency: "aud",
    quantity: 1,
    size: "M",
  },
  GOOD_PANTY_ITEM: {
    kind: "panty" as const,
    id: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    title: "Silk noir",
    unit_amount_cents: 8500,
    currency: "aud",
    quantity: 1,
    size: "S",
  },
}));
vi.mock("@/lib/cart", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cart")>("@/lib/cart");
  const items = [BAD_PANTY_ITEM, GOOD_PANTY_ITEM];
  return {
    ...actual,
    useCart: () => ({
      items,
      count: items.length,
      subtotalCents:
        BAD_PANTY_ITEM.unit_amount_cents + GOOD_PANTY_ITEM.unit_amount_cents,
      hasPanty: true,
      currency: BAD_PANTY_ITEM.currency,
      ...actual.cart,
    }),
    cart: { ...actual.cart, snapshot: () => items },
  };
});

// Checkout hook: spy on openCheckout so we can assert it's NOT called.
const { mockOpenCheckout, mockTrack } = vi.hoisted(() => ({
  mockOpenCheckout: vi.fn(),
  mockTrack: vi.fn(),
}));
vi.mock("@/hooks/useStripeCheckout", () => ({
  useStripeCheckout: () => ({
    openCheckout: mockOpenCheckout,
    checkoutElement: null,
    isOpen: false,
  }),
}));

// track: swallow analytics.
vi.mock("@/lib/track", () => ({ track: mockTrack }));

// sonner: capture toast calls.
const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mockToast }));

import { Route as CartCheckoutRoute } from "./checkout.cart";

const CartCheckoutPage = (CartCheckoutRoute as unknown as {
  component: () => React.ReactElement;
}).component;

beforeEach(() => {
  mockOpenCheckout.mockClear();
  mockTrack.mockClear();
  mockToast.mockClear();
  mockToast.error.mockClear();
  mockToast.success.mockClear();
});

afterEach(() => cleanup());

describe("CartCheckoutPage — non-UUID pantyListingId guard", () => {
  it("shows an inline error badge, disables ONLY the invalid line's Pay button, and still lets the valid line check out", async () => {
    render(<CartCheckoutPage />);

    // Both lines render.
    const badRow = (await screen.findByText(BAD_PANTY_ITEM.title)).closest(
      "li",
    ) as HTMLLIElement;
    const goodRow = screen.getByText(GOOD_PANTY_ITEM.title).closest(
      "li",
    ) as HTMLLIElement;
    expect(badRow).not.toBeNull();
    expect(goodRow).not.toBeNull();

    // Inline error badge is rendered next to the invalid title, and the row
    // is flagged via data-invalid-id so styling/analytics can target it.
    const badge = within(badRow).getByRole("status", {
      name: new RegExp(`${BAD_PANTY_ITEM.title}.*can't be checked out`, "i"),
    });
    expect(badge.textContent).toMatch(/can't check out/i);
    expect(badRow.getAttribute("data-invalid-id")).toBe("true");
    expect(goodRow.getAttribute("data-invalid-id")).toBeNull();

    // Per-line remediation copy is visible under the invalid row so the
    // shopper understands why Pay is disabled.
    expect(
      within(badRow).getByText(/reference is out of date/i),
    ).toBeTruthy();

    // The invalid line's Pay button is disabled (both HTML + ARIA), the
    // valid line's is not.
    const badPay = within(badRow).getByRole("button", {
      name: /pay with crypto/i,
    }) as HTMLButtonElement;
    const goodPay = within(goodRow).getByRole("button", {
      name: /pay with crypto/i,
    }) as HTMLButtonElement;
    expect(badPay.disabled).toBe(true);
    expect(badPay.getAttribute("aria-disabled")).toBe("true");
    expect(goodPay.disabled).toBe(false);
    expect(goodPay.getAttribute("aria-disabled")).toBe("false");

    // Clicking the disabled invalid-line button is a no-op — the browser
    // suppresses onClick on `disabled` buttons, so neither the guard toast
    // nor the invalid-id analytics event fires from a user click.
    fireEvent.click(badPay);
    expect(mockToast.error).not.toHaveBeenCalled();
    expect(mockOpenCheckout).not.toHaveBeenCalled();
    expect(mockTrack).not.toHaveBeenCalledWith(
      "cart_checkout_invalid_id",
      expect.anything(),
    );

    // The valid line's Pay button still reaches the checkout provider with
    // its UUID id — proving the disable is scoped to the invalid row only.
    fireEvent.click(goodPay);
    expect(mockOpenCheckout).toHaveBeenCalledTimes(1);
    expect(mockOpenCheckout).toHaveBeenCalledWith({
      pantyListingId: GOOD_PANTY_ITEM.id,
    });
    expect(mockTrack).toHaveBeenCalledWith(
      "nowpayments_cart_checkout_click",
      expect.objectContaining({ kind: "panty", id: GOOD_PANTY_ITEM.id }),
    );
  });
});
