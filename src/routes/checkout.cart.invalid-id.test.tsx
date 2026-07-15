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
import { cleanup, render, screen, fireEvent } from "@testing-library/react";

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
const { BAD_PANTY_ITEM } = vi.hoisted(() => ({
  BAD_PANTY_ITEM: {
    kind: "panty" as const,
    id: "panty_24hr_aud", // legacy Stripe lookup key, NOT a UUID
    title: "24-hour worn cotton",
    unit_amount_cents: 5900,
    currency: "aud",
    quantity: 1,
    size: "M",
  },
}));
vi.mock("@/lib/cart", async () => {
  const actual = await vi.importActual<typeof import("@/lib/cart")>("@/lib/cart");
  const items = [BAD_PANTY_ITEM];
  return {
    ...actual,
    useCart: () => ({
      items,
      count: 1,
      subtotalCents: BAD_PANTY_ITEM.unit_amount_cents,
      hasPanty: true,
      currency: BAD_PANTY_ITEM.currency,
      ...actual.cart,
    }),
    cart: { ...actual.cart, snapshot: () => items },
  };
});

// Checkout hook: spy on openCheckout so we can assert it's NOT called.
const mockOpenCheckout = vi.fn();
vi.mock("@/hooks/useStripeCheckout", () => ({
  useStripeCheckout: () => ({
    openCheckout: mockOpenCheckout,
    checkoutElement: null,
    isOpen: false,
  }),
}));

// track: swallow analytics.
const mockTrack = vi.fn();
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
  it("blocks checkout and surfaces the toast without calling the Edge Function", async () => {
    render(<CartCheckoutPage />);

    // The bad-id panty line renders (bypasses the localStorage read filter
    // via the mocked snapshot) so its Pay button is clickable.
    const payBtn = await screen.findByRole("button", {
      name: /pay with crypto/i,
    });
    fireEvent.click(payBtn);

    // Guard fires the FetLife-style targeted error toast — title + the
    // remediation description that tells the admin exactly what to do.
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    const [title, opts] = mockToast.error.mock.calls[0]!;
    expect(String(title)).toMatch(/this item can't be checked out/i);
    const desc = String((opts as { description?: string }).description);
    expect(desc).toMatch(/reference is out of date/i);
    expect(desc).toMatch(/remove it from the cart/i);

    // Critical: the NOWPayments checkout Edge Function is NEVER invoked
    // with the bad id — the guard short-circuits before openCheckout.
    expect(mockOpenCheckout).not.toHaveBeenCalled();

    // A dedicated analytics event fires so recurring bad-id checkouts are
    // observable outside a single admin's session.
    expect(mockTrack).toHaveBeenCalledWith(
      "cart_checkout_invalid_id",
      expect.objectContaining({ kind: "panty", id: BAD_PANTY_ITEM.id }),
    );
    // And the normal click-intent event MUST NOT fire — that would double-
    // count and imply a successful checkout attempt reached the provider.
    expect(mockTrack).not.toHaveBeenCalledWith(
      "nowpayments_cart_checkout_click",
      expect.anything(),
    );
  });
});
