// @vitest-environment jsdom
/**
 * End-to-end render test for `/account/orders`.
 *
 * Verifies the page correctly renders both the empty-account state and a
 * populated account with a mix of NOWPayments invoice statuses and
 * derived entitlement states (active pass, pending panty order, revoked
 * booking, lifetime membership).
 *
 * The `listMyOrders` server function is mocked so we control the row
 * shape end-to-end without needing an authenticated Supabase session.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MyOrderRow } from "@/lib/orders.functions";

// The route file imports these — swap for browser-safe stand-ins.
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ to, children, className }: { to: string; children: React.ReactNode; className?: string }) => (
    <a href={to} className={className} data-testid={`link-${to}`}>
      {children}
    </a>
  ),
}));

const mockListMyOrders = vi.fn();

vi.mock("@tanstack/react-start", () => ({
  useServerFn: (_fn: unknown) => (args: unknown) => mockListMyOrders(args),
}));

vi.mock("@/lib/orders.functions", () => ({
  listMyOrders: vi.fn(),
}));

import { MyOrdersPage } from "./account.orders";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MyOrdersPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockListMyOrders.mockReset();
});
afterEach(() => cleanup());

describe("/account/orders — empty account", () => {
  it("shows the empty state and zero counts when the user has no orders", async () => {
    mockListMyOrders.mockResolvedValue({
      rows: [],
      summary: { total: 0, active: 0, granted: 0, pending: 0, expired: 0, revoked: 0 },
    });

    renderPage();

    // Empty-state copy plus a browse CTA back to the shop.
    await screen.findByText(/you have no orders yet/i);
    expect(screen.getByTestId("link-/").textContent).toMatch(/browse passes and content/i);

    // Summary cards render zeros for every bucket.
    const summarySection = screen.getByText("Total").closest("section")!;
    for (const label of ["Total", "Active", "Granted", "Pending", "Expired / revoked"]) {
      const card = within(summarySection).getByText(label).closest("div")!;
      expect(within(card).getByText("0")).toBeTruthy();
    }

    // No table when there are no rows.
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("/account/orders — populated account", () => {
  const rows: MyOrderRow[] = [
    {
      kind: "all_access_pass",
      id: "mem-active-30d",
      environment: "live",
      amount_cents: 1500,
      currency: "aud",
      invoice_status: "invoice paid",
      entitlement_state: "active",
      entitlement_reason: "Access until 2026-12-31 00:00",
      detail: "All-Access Pass · term_pass_all_access_30d",
      payment_reference: "nowpayments:9001",
      created_at: "2026-06-01T10:00:00.000Z",
      expires_at: "2026-12-31T00:00:00.000Z",
    },
    {
      kind: "panty",
      id: "panty-pending",
      environment: "sandbox",
      amount_cents: 4200,
      currency: "aud",
      invoice_status: "invoice awaiting payment",
      entitlement_state: "pending",
      entitlement_reason: "Awaiting NOWPayments confirmation",
      detail: "Panty listing · panty_48hr_aud · AUD 42.00",
      payment_reference: null,
      created_at: "2026-05-20T09:00:00.000Z",
      expires_at: null,
    },
    {
      kind: "booking",
      id: "booking-cancelled",
      environment: "live",
      amount_cents: 20000,
      currency: "aud",
      invoice_status: "invoice paid",
      entitlement_state: "revoked",
      entitlement_reason: "Booking cancelled",
      detail: "Private room · 2026-07-01 · 60m",
      payment_reference: "nowpayments:9010",
      created_at: "2026-05-10T09:00:00.000Z",
      expires_at: null,
    },
    {
      kind: "lifetime",
      id: "mem-lifetime",
      environment: "live",
      amount_cents: 50000,
      currency: "aud",
      invoice_status: "invoice paid",
      entitlement_state: "active",
      entitlement_reason: "Lifetime membership — never expires",
      detail: "Lifetime membership · lifetime",
      payment_reference: "nowpayments:8000",
      created_at: "2026-01-01T09:00:00.000Z",
      expires_at: null,
    },
  ];

  it("renders one row per order with correct invoice status and entitlement badges", async () => {
    mockListMyOrders.mockResolvedValue({
      rows,
      summary: { total: 4, active: 2, granted: 0, pending: 1, expired: 0, revoked: 1 },
    });

    renderPage();

    // Wait for the table (indicates data loaded).
    const table = await screen.findByRole("table");

    // Summary counts reflect the mixed states.
    const summarySection = screen.getByText("Total").closest("section")!;
    expect(within(within(summarySection).getByText("Total").closest("div")!).getByText("4")).toBeTruthy();
    expect(within(within(summarySection).getByText("Active").closest("div")!).getByText("2")).toBeTruthy();
    expect(within(within(summarySection).getByText("Pending").closest("div")!).getByText("1")).toBeTruthy();
    // Expired / revoked = 0 + 1
    expect(
      within(within(summarySection).getByText("Expired / revoked").closest("div")!).getByText("1"),
    ).toBeTruthy();

    // One data row per order (plus the header row).
    const bodyRows = within(table).getAllByRole("row").slice(1);
    expect(bodyRows).toHaveLength(rows.length);

    // The active All-Access Pass row shows its invoice status, badge, and env.
    const passRow = bodyRows.find((r) => within(r).queryByText("All-Access Pass"))!;
    expect(passRow).toBeTruthy();
    expect(within(passRow).getByText("invoice paid")).toBeTruthy();
    expect(within(passRow).getByText("active")).toBeTruthy();
    expect(within(passRow).getByText("live")).toBeTruthy();
    expect(within(passRow).getByText("AUD 15.00")).toBeTruthy();

    // Pending panty order surfaces the "awaiting payment" invoice label and
    // the pending entitlement badge.
    const pantyRow = bodyRows.find((r) => within(r).queryByText("Panty order"))!;
    expect(within(pantyRow).getByText("invoice awaiting payment")).toBeTruthy();
    expect(within(pantyRow).getByText("pending")).toBeTruthy();

    // Revoked booking shows the revoked entitlement badge.
    const bookingRow = bodyRows.find((r) => within(r).queryByText("Room booking"))!;
    expect(within(bookingRow).getByText("revoked")).toBeTruthy();
    expect(within(bookingRow).getByText(/booking cancelled/i)).toBeTruthy();

    // Lifetime membership stays active with the never-expires reason.
    const lifetimeRow = bodyRows.find((r) => within(r).queryByText("Lifetime membership"))!;
    expect(within(lifetimeRow).getAllByText("active").length).toBeGreaterThan(0);
  });

  it("expanding a row reveals the NOWPayments payment reference and order detail", async () => {
    mockListMyOrders.mockResolvedValue({
      rows,
      summary: { total: 4, active: 2, granted: 0, pending: 1, expired: 0, revoked: 1 },
    });

    renderPage();
    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const passRow = bodyRows.find((r) => within(r).queryByText("All-Access Pass"))!;

    fireEvent.click(passRow);

    // The expansion row is the next sibling. Assert reference and detail render.
    await waitFor(() => {
      expect(screen.getByText("nowpayments:9001")).toBeTruthy();
    });
    expect(screen.getByText(/all-access pass · term_pass_all_access_30d/i)).toBeTruthy();
    expect(screen.getByText("mem-active-30d")).toBeTruthy();
  });

  it("pending rows show '— (invoice not yet settled)' when expanded — no payment reference yet", async () => {
    mockListMyOrders.mockResolvedValue({
      rows,
      summary: { total: 4, active: 2, granted: 0, pending: 1, expired: 0, revoked: 1 },
    });

    renderPage();
    const table = await screen.findByRole("table");
    const bodyRows = within(table).getAllByRole("row").slice(1);
    const pantyRow = bodyRows.find((r) => within(r).queryByText("Panty order"))!;

    fireEvent.click(pantyRow);

    await waitFor(() => {
      expect(screen.getByText(/invoice not yet settled/i)).toBeTruthy();
    });
  });
});
