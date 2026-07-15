// @vitest-environment jsdom
/**
 * Integration test: FetLife handle confirmation gate.
 *
 * Because the FetLife handle drives a public profile URL on the homepage,
 * a typo silently sends visitors to the wrong (or a missing) profile. The
 * admin settings form guards handle changes behind an AlertDialog: hitting
 * Save while the handle has been edited must NOT persist until the admin
 * explicitly confirms "Yes, update handle".
 *
 * This test wires up the real `AdminSettings` component with mocked server
 * functions and asserts:
 *   1. Editing only non-FetLife fields saves immediately (no dialog).
 *   2. Editing the FetLife handle opens the confirm dialog on Save and does
 *      NOT call the update server function.
 *   3. Clicking "Keep current handle" dismisses the dialog and still does
 *      NOT call the update server function.
 *   4. Clicking "Yes, update handle" closes the dialog and DOES call the
 *      update server function with the new normalized handle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// The route file imports these — swap for browser-safe stand-ins.
vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-router",
  );
  return {
    ...actual,
    createFileRoute: () => (opts: unknown) => opts,
    getRouteApi: () => ({
      useSearch: () => ({ q: "", from: "", to: "", page: 1, pageSize: 10 }),
    }),
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

// Server-fn caller — return the underlying mock fn passed in.
vi.mock("@tanstack/react-start", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-start",
  );
  return {
    ...actual,
    useServerFn: (fn: unknown) => fn,
  };
});

// Admin gate — always allow.
vi.mock("@/lib/admin.functions", () => ({
  amIAdmin: vi.fn(async () => ({ isAdmin: true })),
}));

const SAVED = {
  email: "midnight-glory@princesspink90.com",
  fetlife_handle: "Gloryhole-Queen",
  reddit_handle: "19pink-princess90",
  glory_holes_enabled: true,
  session_price_cents: 27500,
  session_duration_minutes: 60,
};

const mockUpdateSiteSettings = vi.fn(async (_args: { data: typeof SAVED }) => ({ ok: true }));

vi.mock("@/lib/settings.functions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/settings.functions",
  );
  return {
    ...actual,
    getSiteSettings: vi.fn(async () => SAVED),
    updateSiteSettings: (args: { data: typeof SAVED }) => mockUpdateSiteSettings(args),
    listPricingAudit: vi.fn(async () => ({ rows: [], total: 0, page: 1, pageSize: 10 })),
    exportPricingAudit: vi.fn(async () => ""),
    listContactSettingsAudit: vi.fn(async () => []),
  };
});

vi.mock("@/lib/reminder-job-config.functions", () => ({
  getReminderJobConfig: vi.fn(async () => ({
    daily_run_time_utc: "08:00",
    expiring_within_days: 7,
    updated_at: null,
  })),
  updateReminderJobConfig: vi.fn(async () => ({ ok: true })),
}));

// RoleGuard: pass through (we've mocked amIAdmin to return true anyway).
vi.mock("@/components/RoleGuard", () => ({
  RoleGuard: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

// sonner: capture toast calls so we can assert on cancel-notifications.
const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: mockToast,
}));

import { AdminSettings } from "./admin.settings";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AdminSettings />
    </QueryClientProvider>,
  );
}

async function waitForFormLoaded() {
  // The FetLife input is populated from the loaded settings — waiting for
  // its value is a reliable readiness signal for the whole form.
  await waitFor(() => {
    const input = screen.getByDisplayValue(SAVED.fetlife_handle);
    expect(input).toBeTruthy();
  });
}

beforeEach(() => {
  mockUpdateSiteSettings.mockClear();
  mockToast.mockClear();
  mockToast.success.mockClear();
  mockToast.error.mockClear();
});
afterEach(() => cleanup());

describe("admin settings — FetLife confirmation gate", () => {
  it("saves immediately when the FetLife handle is unchanged", async () => {
    renderPage();
    await waitForFormLoaded();

    // Edit a non-FetLife field (reddit handle) and submit.
    const redditInput = screen.getByDisplayValue(SAVED.reddit_handle);
    fireEvent.change(redditInput, { target: { value: "some-other-handle" } });

    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    // No confirmation dialog should appear.
    expect(
      screen.queryByRole("alertdialog", { name: /confirm fetlife handle/i }),
    ).toBeNull();

    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    });
    const call = mockUpdateSiteSettings.mock.calls[0]![0] as {
      data: typeof SAVED;
    };
    expect(call.data.fetlife_handle).toBe(SAVED.fetlife_handle);
    expect(call.data.reddit_handle).toBe("some-other-handle");
  });

  it("blocks Save behind the confirm dialog when the FetLife handle changes", async () => {
    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle);
    fireEvent.change(fetInput, { target: { value: "New-Handle-99" } });

    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    // The dialog opens…
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(/confirm fetlife handle/i)).toBeTruthy();
    expect(within(dialog).getAllByText(/New-Handle-99/)[0]).toBeTruthy();

    // …and update MUST NOT have been called yet.
    expect(mockUpdateSiteSettings).not.toHaveBeenCalled();
  });

  it("cancelling the dialog does not persist the change", async () => {
    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle);
    fireEvent.change(fetInput, { target: { value: "Another-Handle" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /keep current handle/i }),
    );

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(mockUpdateSiteSettings).not.toHaveBeenCalled();
  });

  it("confirming the dialog persists the new normalized handle", async () => {
    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle);
    // Paste a full profile URL — the form normalizes it to just the handle.
    fireEvent.change(fetInput, {
      target: { value: "https://fetlife.com/Brand-New-Handle" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");
    // Preview should show the normalized handle, not the raw URL.
    expect(within(dialog).getAllByText(/Brand-New-Handle/)[0]).toBeTruthy();

    fireEvent.click(
      within(dialog).getByRole("button", { name: /yes, update handle/i }),
    );

    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    });
    const call = mockUpdateSiteSettings.mock.calls[0]![0] as {
      data: typeof SAVED;
    };
    expect(call.data.fetlife_handle).toBe("Brand-New-Handle");
  });
});
