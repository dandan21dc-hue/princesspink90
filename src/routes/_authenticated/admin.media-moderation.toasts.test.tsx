// @vitest-environment jsdom
/**
 * Integration test: moderation action toasts.
 *
 * The media moderation queue is the admin's only signal that a
 * moderate/delete request actually landed against the backend. If a toast is
 * silently dropped (e.g. mutation wired to onSettled instead of
 * onSuccess/onError, or an error swallowed) the admin sees a spinner blink
 * and assumes success. This test wires up the real page component with
 * mocked server functions and asserts that every action (approve, reject,
 * send-back-to-pending, delete) fires the correct sonner toast on both
 * success and failure.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

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
  };
});

vi.mock("@tanstack/react-start", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@tanstack/react-start",
  );
  return {
    ...actual,
    useServerFn: (fn: unknown) => fn,
  };
});

vi.mock("@/lib/admin.functions", () => ({
  amIAdmin: vi.fn(async () => ({ isAdmin: true })),
}));

const ROW = {
  id: "item-1",
  kind: "photo",
  title: "Sunset Shoot",
  description: null,
  cover_url: null,
  media_urls: [],
  creator_id: "creator-1",
  published: false,
  moderation_status: "pending" as const,
  moderation_notes: null,
  moderation_reviewed_at: null,
  moderation_submitted_at: new Date("2025-01-01T00:00:00Z").toISOString(),
  created_at: new Date("2025-01-01T00:00:00Z").toISOString(),
};

const mockListQueue = vi.fn(async () => [ROW]);
const mockModerate = vi.fn(async (_args: unknown) => ({ ok: true }));
const mockDelete = vi.fn(async (_args: unknown) => ({ ok: true }));
const mockListAudit = vi.fn(async () => []);
const mockGetUrl = vi.fn(async () => ({ url: "https://example.test/x" }));

vi.mock("@/lib/store.functions", () => ({
  adminListModerationQueue: (args: unknown) => mockListQueue(),
  adminModerateContentItem: (args: unknown) => mockModerate(args),
  adminDeleteContentItem: (args: unknown) => mockDelete(args),
  adminListModerationAudit: () => mockListAudit(),
  adminGetModerationMediaUrl: () => mockGetUrl(),
}));

const { mockToast } = vi.hoisted(() => ({
  mockToast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: mockToast }));

import { AdminMediaModeration } from "./admin.media-moderation";

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AdminMediaModeration />
    </QueryClientProvider>,
  );
}

async function waitForRow() {
  await waitFor(() => {
    expect(screen.getByText(ROW.title)).toBeTruthy();
  });
}

beforeEach(() => {
  mockListQueue.mockClear();
  mockListQueue.mockImplementation(async () => [ROW]);
  mockModerate.mockClear();
  mockModerate.mockImplementation(async () => ({ ok: true }));
  mockDelete.mockClear();
  mockDelete.mockImplementation(async () => ({ ok: true }));
  mockListAudit.mockClear();
  mockToast.mockClear();
  mockToast.success.mockClear();
  mockToast.error.mockClear();
});
afterEach(() => cleanup());

describe("admin media moderation — action toasts", () => {
  it.each([
    {
      label: "Approve",
      button: /^approve$/i,
      match: /approved: sunset shoot/i,
    },
    {
      label: "Reject",
      button: /^reject$/i,
      match: /rejected: sunset shoot/i,
    },
    {
      label: "Send back to pending",
      button: /send back to pending/i,
      match: /sent back to pending: sunset shoot/i,
      setup: () => {
        // Row must not already be pending for the button to render.
        mockListQueue.mockImplementation(async () => [
          { ...ROW, moderation_status: "approved" as const },
        ]);
      },
    },
  ])(
    "fires a success toast on $label",
    async ({ button, match, setup }) => {
      setup?.();
      renderPage();
      await waitForRow();

      fireEvent.click(screen.getByRole("button", { name: button }));

      await waitFor(() => {
        expect(mockModerate).toHaveBeenCalledTimes(1);
        expect(mockToast.success).toHaveBeenCalled();
      });
      const first = mockToast.success.mock.calls[0]![0] as string;
      expect(first).toMatch(match);
      expect(mockToast.error).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "Approve", button: /^approve$/i, decision: /approved/i },
    { label: "Reject", button: /^reject$/i, decision: /rejected/i },
    {
      label: "Send back to pending",
      button: /send back to pending/i,
      decision: /pending/i,
      setup: () => {
        mockListQueue.mockImplementation(async () => [
          { ...ROW, moderation_status: "approved" as const },
        ]);
      },
    },
  ])(
    "fires an error toast when $label fails",
    async ({ button, decision, setup }) => {
      setup?.();
      mockModerate.mockImplementation(async () => {
        throw new Error("boom");
      });
      renderPage();
      await waitForRow();

      fireEvent.click(screen.getByRole("button", { name: button }));

      await waitFor(() => {
        expect(mockToast.error).toHaveBeenCalled();
      });
      const [msg, opts] = mockToast.error.mock.calls[0]! as [
        string,
        { description?: string },
      ];
      expect(msg).toMatch(/couldn't mark "sunset shoot" as/i);
      expect(msg).toMatch(decision);
      expect(opts?.description).toBe("boom");
      expect(mockToast.success).not.toHaveBeenCalled();
    },
  );

  it("fires a success toast on Delete (after confirming)", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage();
    await waitForRow();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledTimes(1);
      expect(mockToast.success).toHaveBeenCalled();
    });
    const first = mockToast.success.mock.calls[0]![0] as string;
    expect(first).toMatch(/deleted: sunset shoot/i);
    expect(mockToast.error).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("does NOT toast or delete when the confirm dialog is dismissed", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage();
    await waitForRow();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it("fires an error toast when Delete fails", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    mockDelete.mockImplementation(async () => {
      throw new Error("db offline");
    });
    renderPage();
    await waitForRow();

    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalled();
    });
    const [msg, opts] = mockToast.error.mock.calls[0]! as [
      string,
      { description?: string },
    ];
    expect(msg).toMatch(/couldn't delete "sunset shoot"/i);
    expect(opts?.description).toBe("db offline");
    expect(mockToast.success).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });
});
