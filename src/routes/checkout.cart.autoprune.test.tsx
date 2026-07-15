// @vitest-environment jsdom
/**
 * Integration test: on mount, the cart checkout page auto-removes any
 * panty cart lines whose id is not a UUID (legacy Stripe lookup keys,
 * tampered localStorage) AND fires a single toast so the shopper knows
 * why the cart shrank.
 *
 * The prune itself already happened silently on every hydration — this
 * test locks in the added user-facing behavior: (a) the invalid line is
 * gone from the rendered list, (b) localStorage no longer contains it,
 * and (c) exactly one toast fires that names the removed titles.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

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

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      getUser: async () => ({
        data: { user: { id: "user-1", email: "u@example.com" } },
      }),
    },
  },
}));

const { mockOpenCheckout } = vi.hoisted(() => ({
  mockOpenCheckout: vi.fn(),
}));
vi.mock("@/hooks/useStripeCheckout", () => ({
  useStripeCheckout: () => ({
    openCheckout: mockOpenCheckout,
    checkoutElement: null,
    isOpen: false,
  }),
}));

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mockToast }));

// Real cart module — we want the actual hydration/prune/localStorage flow.
import { Route as CartCheckoutRoute } from "./checkout.cart";

const CartCheckoutPage = (CartCheckoutRoute as unknown as {
  component: () => React.ReactElement;
}).component;

const VALID_PANTY = {
  kind: "panty" as const,
  id: "11111111-2222-3333-4444-555555555555",
  title: "Silk noir",
  unit_amount_cents: 8500,
  currency: "aud",
  quantity: 1,
  size: "S",
};
const LEGACY_PANTY = {
  kind: "panty" as const,
  id: "panty_24hr_aud", // legacy Stripe lookup key — not a UUID
  title: "24-hour worn cotton",
  unit_amount_cents: 5900,
  currency: "aud",
  quantity: 1,
  size: "M",
};

const STORAGE_KEY = "pp_cart_v1";

beforeEach(() => {
  mockOpenCheckout.mockClear();
  mockToast.mockClear();
  mockToast.error.mockClear();
  mockToast.success.mockClear();
  // Seed localStorage BEFORE the cart module hydrates. Vitest isolates
  // modules per file so the module-level `hydrated` flag is fresh here.
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify([VALID_PANTY, LEGACY_PANTY]),
  );
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("CartCheckoutPage — auto-prune of invalid cart items", () => {
  it("removes non-UUID panty lines from the UI + localStorage and fires one explanatory toast", async () => {
    render(<CartCheckoutPage />);

    // The valid line renders with its Pay button — the invalid one does not.
    await screen.findByText(VALID_PANTY.title);
    expect(screen.queryByText(LEGACY_PANTY.title)).toBeNull();
    expect(screen.getAllByRole("button", { name: /pay with crypto/i }).length).toBe(1);

    // Exactly one toast fires — no chatter per-row, no follow-ups.
    expect(mockToast.error).toHaveBeenCalledTimes(1);
    const [title, opts] = mockToast.error.mock.calls[0]!;
    expect(String(title)).toMatch(/removed 1 item from your cart/i);
    const desc = String((opts as { description?: string }).description);
    // The removed item's title is named so the shopper can find + re-add it.
    expect(desc).toContain(LEGACY_PANTY.title);
    expect(desc).toMatch(/add the current listings again/i);

    // localStorage was rewritten to the cleaned list — the bad id is gone
    // for good, so re-mounts and other tabs don't re-toast about it.
    const persisted = JSON.parse(
      window.localStorage.getItem(STORAGE_KEY) ?? "[]",
    ) as Array<{ id: string }>;
    expect(persisted.map((it) => it.id)).toEqual([VALID_PANTY.id]);

    // No accidental checkout call — the bad line never reached the provider.
    expect(mockOpenCheckout).not.toHaveBeenCalled();
  });
});
