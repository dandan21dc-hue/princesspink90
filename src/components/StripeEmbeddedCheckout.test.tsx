// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mocks -------------------------------------------------------------------

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => Promise.resolve({ __mockStripe: true })),
  getStripeEnvironment: vi.fn(() => "sandbox"),
}));

const createStoreCheckoutSession = vi.fn();
vi.mock("@/lib/store.functions", () => ({
  createStoreCheckoutSession: (...args: unknown[]) =>
    createStoreCheckoutSession(...args),
}));

vi.mock("@/lib/track", () => ({ track: vi.fn() }));

// Capture every `options` object handed to the provider so we can assert
// referential stability per checkout session.
const capturedOptions: Array<{ fetchClientSecret: () => Promise<string> }> = [];
vi.mock("@stripe/react-stripe-js", () => ({
  EmbeddedCheckoutProvider: ({
    options,
    children,
  }: {
    options: { fetchClientSecret: () => Promise<string> };
    children: React.ReactNode;
  }) => {
    capturedOptions.push(options);
    return <div data-testid="provider">{children}</div>;
  },
  EmbeddedCheckout: () => <div data-testid="embedded-checkout" />,
}));

// detectCountry() hits cloudflare — stub fetch so it resolves fast.
beforeEach(() => {
  capturedOptions.length = 0;
  createStoreCheckoutSession.mockReset();
  createStoreCheckoutSession.mockResolvedValue({ clientSecret: "cs_test_123" });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve({ text: () => Promise.resolve("loc=AU\n") } as Response),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// Imported AFTER mocks so the component sees them.
import { StripeEmbeddedCheckout } from "./StripeEmbeddedCheckout";

describe("<StripeEmbeddedCheckout /> single-init guard", () => {
  it("uses one options object across renders within a single attempt", async () => {
    const { rerender } = render(
      <StripeEmbeddedCheckout priceId="all_access_monthly_aud" />,
    );
    // Force several re-renders that do NOT change attempt.
    for (let i = 0; i < 5; i++) {
      rerender(<StripeEmbeddedCheckout priceId="all_access_monthly_aud" />);
    }
    // All captured options must be the exact same reference — a new object
    // would trigger Stripe's "cannot change fetchClientSecret" error.
    const first = capturedOptions[0];
    expect(capturedOptions.length).toBeGreaterThan(1);
    for (const opt of capturedOptions) {
      expect(opt).toBe(first);
      expect(typeof opt.fetchClientSecret).toBe("function");
    }
  });

  it("dedupes rapid fetchClientSecret invocations to one server call per attempt", async () => {
    render(<StripeEmbeddedCheckout priceId="all_access_monthly_aud" />);
    await waitFor(() => expect(capturedOptions.length).toBeGreaterThan(0));
    const opts = capturedOptions[0];

    // Simulate rapid re-invocations (StrictMode double-invoke, provider retry).
    const promises = await act(async () => {
      const list = [
        opts.fetchClientSecret(),
        opts.fetchClientSecret(),
        opts.fetchClientSecret(),
      ];
      return Promise.all(list);
    });

    // All callers get the same client secret from a single server call.
    expect(promises).toEqual(["cs_test_123", "cs_test_123", "cs_test_123"]);
    expect(createStoreCheckoutSession).toHaveBeenCalledTimes(1);
  });

  it("creates a fresh options object and single new server call per retry", async () => {
    const { getByRole } = render(
      <StripeEmbeddedCheckout priceId="all_access_monthly_aud" />,
    );
    // First attempt fails so the retry button appears.
    createStoreCheckoutSession.mockRejectedValueOnce(new Error("boom"));
    await waitFor(() => expect(capturedOptions.length).toBeGreaterThan(0));
    // Trigger the first (failing) fetch.
    await act(async () => {
      await capturedOptions[0].fetchClientSecret().catch(() => {});
    });

    const attempt1Options = capturedOptions[capturedOptions.length - 1];
    const initialCalls = createStoreCheckoutSession.mock.calls.length;

    // Rapidly click Retry multiple times — should only bump attempt once
    // per click, and the newly-installed options object should be stable.
    const user = userEvent.setup();
    const retry = await waitFor(() => getByRole("button", { name: /retry/i }));
    await user.click(retry);

    await waitFor(() => {
      const latest = capturedOptions[capturedOptions.length - 1];
      expect(latest).not.toBe(attempt1Options);
    });
    const attempt2Options = capturedOptions[capturedOptions.length - 1];

    // Rapid duplicate calls on the new attempt still dedupe to one server call.
    await act(async () => {
      await Promise.all([
        attempt2Options.fetchClientSecret(),
        attempt2Options.fetchClientSecret(),
        attempt2Options.fetchClientSecret(),
      ]);
    });

    expect(createStoreCheckoutSession.mock.calls.length).toBe(initialCalls + 1);
  });
});
