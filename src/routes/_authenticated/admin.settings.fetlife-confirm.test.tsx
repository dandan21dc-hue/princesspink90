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
const mockGetSiteSettings = vi.fn(async () => SAVED);

vi.mock("@/lib/settings.functions", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "@/lib/settings.functions",
  );
  return {
    ...actual,
    getSiteSettings: () => mockGetSiteSettings(),
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
  mockUpdateSiteSettings.mockImplementation(async () => ({ ok: true }));
  mockGetSiteSettings.mockClear();
  mockGetSiteSettings.mockImplementation(async () => SAVED);
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

  it("cancelling the dialog does not persist the change and toasts the admin", async () => {
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

    // Toast confirms the admin that nothing was saved, and echoes the
    // current handle so they know what the public link still points to.
    // Two toasts fire: (1) "Confirmation required" when the dialog opens so
    // the admin knows Save didn't persist, (2) "not saved" when they cancel.
    expect(mockToast).toHaveBeenCalledTimes(2);
    expect(String(mockToast.mock.calls[0]![0])).toMatch(/confirmation required/i);
    const [message, opts] = mockToast.mock.calls[1]!;
    expect(String(message)).toMatch(/not saved/i);
    expect(String((opts as { description?: string }).description)).toContain(
      SAVED.fetlife_handle,
    );

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
    // Opening the dialog fires the "Confirmation required" nudge, but
    // confirming must NOT trigger the "not saved" cancel toast.
    expect(mockToast).toHaveBeenCalledTimes(1);
    expect(String(mockToast.mock.calls[0]![0])).toMatch(/confirmation required/i);

  });

  it("does not persist the FetLife change in the UI when the save API fails after confirm", async () => {
    // Simulate a server rejection. The mutation's onError toasts + surfaces
    // the message, and — critically — must NOT invalidate the settings query
    // or flip the UI into a "saved" state. The saved handle stays the old
    // one; the draft input keeps what the admin typed so they can retry.
    mockUpdateSiteSettings.mockImplementationOnce(async () => {
      throw new Error("Server exploded");
    });

    renderPage();
    await waitForFormLoaded();

    // Baseline: getSiteSettings fetched once on mount.
    const initialFetchCount = mockGetSiteSettings.mock.calls.length;

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle);
    fireEvent.change(fetInput, { target: { value: "Doomed-Handle" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /yes, update handle/i }),
    );

    // Mutation was attempted with the new handle…
    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    });
    const call = mockUpdateSiteSettings.mock.calls[0]![0] as {
      data: typeof SAVED;
    };
    expect(call.data.fetlife_handle).toBe("Doomed-Handle");

    // …and the failure toast fires with the server message.
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledTimes(1);
    });
    const [errTitle, errOpts] = mockToast.error.mock.calls[0]!;
    expect(String(errTitle)).toMatch(/couldn't save fetlife handle/i);
    const errDesc = String((errOpts as { description?: string }).description);
    expect(errDesc).toMatch(/server exploded/i);
    // Description also reassures the admin the public link is unchanged.
    expect(errDesc).toContain(SAVED.fetlife_handle);


    // Success surface must stay dark: no success toast, no "Saved ✓" indicator.
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Saved ✓$/)).toBeNull();

    // The saved-state snapshot the UI reads from must still be the OLD handle:
    // no refetch of getSiteSettings was triggered (query wasn't invalidated),
    // and the "Live public link preview" still flags the draft as unsaved.
    expect(mockGetSiteSettings.mock.calls.length).toBe(initialFetchCount);
    expect(screen.getAllByText(/unsaved changes/i).length).toBeGreaterThan(0);



    // The draft input keeps what the admin typed so they can fix + retry.
    const draftInput = screen.getByDisplayValue("Doomed-Handle") as HTMLInputElement;
    expect(draftInput.value).toBe("Doomed-Handle");

    // Inline error message from the mutation is shown near the Save button.
    expect(screen.getAllByText(/server exploded/i).length).toBeGreaterThan(0);

    // Focus returns to the FetLife input so the admin can edit + retry
    // without hunting for the field with keyboard or screen reader.
    await waitFor(() => {
      expect(document.activeElement).toBe(draftInput);
    });
  });


  it("retrying after a failed confirmed save persists the new handle and clears the Unsaved changes badge", async () => {
    // First confirmed save fails; the second (retry) succeeds. This guards
    // against a regression where the failed attempt leaves the mutation in
    // a state that blocks retry, or where success fails to refresh the
    // "saved" snapshot and the Unsaved badge stays stuck.
    mockUpdateSiteSettings.mockImplementationOnce(async () => {
      throw new Error("Transient failure");
    });

    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle) as HTMLInputElement;
    fireEvent.change(fetInput, { target: { value: "Retry-Handle" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    // First attempt: confirm the dialog, the server rejects.
    let dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /yes, update handle/i }),
    );

    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledTimes(1);
    });

    // Badge still says Unsaved changes, input still has the draft value.
    expect(screen.getAllByText(/unsaved changes/i).length).toBeGreaterThan(0);
    expect(
      (screen.getByDisplayValue("Retry-Handle") as HTMLInputElement).value,
    ).toBe("Retry-Handle");
    expect(mockToast.success).not.toHaveBeenCalled();

    // Prime the refetch after a successful save to return the new handle so
    // the "saved" snapshot updates and the Unsaved badge clears.
    mockGetSiteSettings.mockImplementation(async () => ({
      ...SAVED,
      fetlife_handle: "Retry-Handle",
    }));

    // Retry: click Save again — the draft is still dirty, so the confirm
    // dialog opens once more. Confirming triggers the second server call.
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);
    dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /yes, update handle/i }),
    );

    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(2);
    });
    const secondCall = mockUpdateSiteSettings.mock.calls[1]![0] as {
      data: typeof SAVED;
    };
    expect(secondCall.data.fetlife_handle).toBe("Retry-Handle");

    // Success toast fires and the Unsaved badge disappears once the refetch
    // brings the saved snapshot in line with the draft.
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByText(/unsaved changes/i)).toBeNull();
    });
    expect(screen.getAllByText(/matches saved/i).length).toBeGreaterThan(0);

    // Input still shows the new handle (now matching the saved snapshot).
    expect(
      (screen.getByDisplayValue("Retry-Handle") as HTMLInputElement).value,
    ).toBe("Retry-Handle");
  });

  it("success toast copy and live-handle reminder reflect the newly saved FetLife handle", async () => {
    // Regression guard: after a successful confirmed save, the success toast
    // title must count the FetLife change, its description must show the new
    // handle in the "FetLife handle → <new>" line (never the stale saved
    // value), and the Live public link preview must render the NEW
    // https://fetlife.com/<new> URL with the "Matches saved" badge — i.e. the
    // saved snapshot has advanced to the draft.
    const NEW_HANDLE = "Fresh-Handle_42";

    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle) as HTMLInputElement;
    fireEvent.change(fetInput, { target: { value: NEW_HANDLE } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");
    // Prime the post-save refetch so the saved snapshot advances to the new
    // handle — otherwise ContactLinkPreview would still see draft ≠ saved.
    mockGetSiteSettings.mockImplementation(async () => ({
      ...SAVED,
      fetlife_handle: NEW_HANDLE,
    }));
    fireEvent.click(within(dialog).getByRole("button", { name: /yes, update handle/i }));

    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledTimes(1);
    });

    // 1. Toast title counts the FetLife change (exactly one field updated).
    const [title, opts] = mockToast.success.mock.calls[0]! as [
      string,
      { description?: React.ReactNode },
    ];
    expect(title).toMatch(/settings saved — 1 field updated/i);

    // 2. Toast description lists the FetLife change with the NEW handle
    //    (never the previously-saved handle).
    const { container: descContainer, unmount: unmountDesc } = render(
      <>{opts.description}</>,
    );
    expect(descContainer.textContent).toContain(`FetLife handle → ${NEW_HANDLE}`);
    expect(descContainer.textContent).not.toContain(SAVED.fetlife_handle);
    unmountDesc();

    // 3. Live public link preview now shows the NEW URL and the "Matches
    //    saved" reminder (draft === saved after the refetch).
    await waitFor(() => {
      expect(screen.getAllByText(/matches saved/i).length).toBeGreaterThan(0);
    });
    const liveLink = screen.getByRole("link", {
      name: `https://fetlife.com/${NEW_HANDLE}`,
    }) as HTMLAnchorElement;
    expect(liveLink.getAttribute("href")).toBe(`https://fetlife.com/${NEW_HANDLE}`);
    // The stale saved URL must NOT still be linked in the preview.
    expect(
      screen.queryByRole("link", {
        name: `https://fetlife.com/${SAVED.fetlife_handle}`,
      }),
    ).toBeNull();
    expect(screen.queryByText(/unsaved changes/i)).toBeNull();
  });

  it("rapid double-clicks on the confirm button only fire one save request", async () => {
    // Regression guard: `save.isPending` only flips true after React re-renders,
    // so two synchronous clicks both saw the stale `false` and each fired a
    // separate `save.mutate()` — two network requests, two audit rows. A
    // synchronous in-flight ref must dedupe.
    let resolveSave: ((value: { ok: true }) => void) | null = null;
    mockUpdateSiteSettings.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle) as HTMLInputElement;
    fireEvent.change(fetInput, { target: { value: "One-Shot-Handle" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", {
      name: /yes, update handle/i,
    }) as HTMLButtonElement;

    // Three synchronous clicks — same tick, so no re-render has run between
    // them. Without the in-flight ref, all three would call save.mutate().
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);
    fireEvent.click(confirmBtn);

    // Give React a chance to flush; the server fn must still have been
    // invoked exactly once.
    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    });

    // While the request is in flight the confirm button must render its
    // disabled loading state so a later click can't slip through either.
    await waitFor(() => {
      expect(
        (within(dialog).getByRole("button", { name: /saving…/i }) as HTMLButtonElement)
          .getAttribute("aria-disabled"),
      ).toBe("true");
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: /saving…/i }),
    );
    expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);

    // Resolve the pending request so React Query settles the mutation and
    // the dialog can close cleanly (avoids act() warnings on teardown).
    (resolveSave as ((value: { ok: true }) => void) | null)?.({ ok: true });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the Saving… spinner and blocks Escape/Cancel until the save settles", async () => {
    // While the confirmed save is in flight the dialog must present a locked
    // loading state: the confirm button flips to a disabled "Saving…" label
    // with the Loader2 spinner, the Cancel ("Keep current handle") button is
    // disabled, and dismissing the dialog via Escape is a no-op. Otherwise a
    // panicked admin could close the dialog mid-request and be left unsure
    // whether the FetLife handle change actually persisted.
    let resolveSave: ((value: { ok: true }) => void) | null = null;
    mockUpdateSiteSettings.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle) as HTMLInputElement;
    fireEvent.change(fetInput, { target: { value: "Locked-While-Saving" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /yes, update handle/i }));

    // Server function was called exactly once and hasn't resolved yet.
    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    });

    // Confirm button: label swaps to "Saving…", is aria-disabled + aria-busy,
    // and renders the Loader2 spinner (identified by lucide's class marker).
    // We use aria-disabled (not the HTML `disabled` attribute) so the button
    // stays in the tab order and Radix's FocusScope keeps focus inside the
    // dialog while the mutation runs.
    const savingBtn = await within(dialog).findByRole("button", {
      name: /saving…/i,
    }) as HTMLButtonElement;
    expect(savingBtn.getAttribute("aria-disabled")).toBe("true");
    expect(savingBtn.getAttribute("aria-busy")).toBe("true");
    expect(savingBtn.querySelector(".lucide-loader-circle")).not.toBeNull();

    // Cancel button: aria-disabled so the admin can't abandon a live request
    // (also inert via pointer-events-none; onClick guard is the last line).
    const cancelBtn = within(dialog).getByRole("button", {
      name: /keep current handle/i,
    }) as HTMLButtonElement;
    expect(cancelBtn.getAttribute("aria-disabled")).toBe("true");
    // Clicking the aria-disabled Cancel is a no-op — the dialog must remain
    // open. Radix's AlertDialogCancel does its own dispatch, so we assert
    // via the onClick guard's observable effect: no state change.
    fireEvent.click(cancelBtn);
    expect(screen.queryByRole("alertdialog")).not.toBeNull();

    // Escape while save is pending: swallowed by onEscapeKeyDown → dialog
    // stays open, no cancel toast fires, no extra server call.
    mockToast.mockClear();
    fireEvent.keyDown(dialog, { key: "Escape", code: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeNull();
    expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    expect(mockToast).not.toHaveBeenCalledWith(
      "FetLife handle change not saved",
      expect.anything(),
    );

    // Resolve the pending mutation; dialog closes, success toast fires.
    (resolveSave as ((value: { ok: true }) => void) | null)?.({ ok: true });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("marks the dialog aria-busy, announces the save via a live region, and keeps focus inside the dialog", async () => {
    // A11y regression guard: while the mutation is in flight the whole
    // dialog must be aria-busy so SR pauses page updates, a polite live
    // region must announce "Saving…", and focus must stay parked on the
    // still-focusable confirm button (using aria-disabled, not `disabled`)
    // so Radix's FocusScope doesn't lose the trap and dump focus on body.
    let resolveSave: ((value: { ok: true }) => void) | null = null;
    mockUpdateSiteSettings.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveSave = resolve;
        }),
    );

    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle) as HTMLInputElement;
    fireEvent.change(fetInput, { target: { value: "A11y-Handle" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");
    const confirmBtn = within(dialog).getByRole("button", {
      name: /yes, update handle/i,
    }) as HTMLButtonElement;
    // Focus the confirm button (mirrors a keyboard user Tabbing to it) so we
    // can prove focus is retained after it flips to the "Saving…" state.
    confirmBtn.focus();
    expect(document.activeElement).toBe(confirmBtn);

    fireEvent.click(confirmBtn);

    // Dialog element itself is announced as busy while the mutation runs.
    await waitFor(() => {
      expect(dialog.getAttribute("aria-busy")).toBe("true");
    });

    // A polite live region inside the dialog surfaces the in-flight message
    // to assistive tech without stealing focus.
    const status = within(dialog).getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toMatch(/saving fetlife handle change/i);

    // Focus stays on the confirm button (now labelled "Saving…"), NOT on
    // <body>. This is the whole point of using aria-disabled instead of the
    // HTML `disabled` attribute: `disabled` yanks focus outside the trap.
    const savingBtn = within(dialog).getByRole("button", {
      name: /saving…/i,
    });
    expect(document.activeElement).toBe(savingBtn);
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Resolve; dialog closes cleanly and the live region unmounts with it.
    (resolveSave as ((value: { ok: true }) => void) | null)?.({ ok: true });
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("still fires the FetLife-specific failure toast with the server message and currently-live handle when the mutation errors out of its loading state", async () => {
    // Regression guard: while save.isPending is true (Loader2 spinner in the
    // dialog, "Saving…" label), the mutation can still reject. The onError
    // path must fire the FetLife-scoped `toast.error("Couldn't save FetLife
    // handle", …)` — NOT the generic "Couldn't save settings" — with:
    //   • the exact server error message, and
    //   • the currently-live (server-side) handle so the admin knows the
    //     public link is unchanged despite the failed attempt.
    let rejectSave: ((err: Error) => void) | null = null;
    mockUpdateSiteSettings.mockImplementationOnce(
      () =>
        new Promise<{ ok: true }>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );

    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle) as HTMLInputElement;
    fireEvent.change(fetInput, { target: { value: "Mid-Flight-Fail" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(
      within(dialog).getByRole("button", { name: /yes, update handle/i }),
    );

    // Confirm we are actually in the pending/loading state before rejecting —
    // this is the "while loading" precondition the test guards.
    await within(dialog).findByRole("button", { name: /saving…/i });
    expect(mockToast.error).not.toHaveBeenCalled();

    // Reject the in-flight save with a distinctive server message.
    (rejectSave as unknown as (e: Error) => void)(
      new Error("Upstream 502 while updating handle"),
    );

    // FetLife-specific failure toast fires exactly once.
    await waitFor(() => {
      expect(mockToast.error).toHaveBeenCalledTimes(1);
    });
    const [errTitle, errOpts] = mockToast.error.mock.calls[0]!;
    expect(String(errTitle)).toMatch(/couldn't save fetlife handle/i);
    // Must NOT be the generic settings-failure toast.
    expect(String(errTitle)).not.toMatch(/couldn't save settings/i);

    const errDesc = String((errOpts as { description?: string }).description);
    // Server error message is echoed verbatim.
    expect(errDesc).toContain("Upstream 502 while updating handle");
    // Currently-live handle (the server-side saved value, NOT the draft the
    // admin just typed) is named so they know the public link is intact.
    expect(errDesc).toContain(SAVED.fetlife_handle);
    expect(errDesc).not.toContain("Mid-Flight-Fail");
  });

  it.each([
    {
      outcome: "success" as const,
      settle: (
        resolve: (v: { ok: true }) => void,
        _reject: (e: Error) => void,
      ) => resolve({ ok: true }),
    },
    {
      outcome: "failure" as const,
      settle: (
        _resolve: (v: { ok: true }) => void,
        reject: (e: Error) => void,
      ) => reject(new Error("Transient upstream error")),
    },
  ])(
    "re-enables the form Save button and clears the Loader2 spinner after a $outcome",
    async ({ settle }) => {
      // Regression guard: onSettled must fire on BOTH paths — otherwise the
      // in-flight ref stays stuck and the whole Save surface remains
      // disabled/spinning even after the request has resolved.
      let resolveSave: ((value: { ok: true }) => void) | null = null;
      let rejectSave: ((err: Error) => void) | null = null;
      mockUpdateSiteSettings.mockImplementationOnce(
        () =>
          new Promise<{ ok: true }>((resolve, reject) => {
            resolveSave = resolve;
            rejectSave = reject;
          }),
      );

      renderPage();
      await waitForFormLoaded();

      const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle) as HTMLInputElement;
      fireEvent.change(fetInput, { target: { value: "Settle-Test-Handle" } });
      fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

      const dialog = await screen.findByRole("alertdialog");
      fireEvent.click(
        within(dialog).getByRole("button", { name: /yes, update handle/i }),
      );

      // Mid-flight: confirm shows the disabled "Saving…" state.
      const savingBtn = await within(dialog).findByRole("button", {
        name: /saving…/i,
      }) as HTMLButtonElement;
      expect(savingBtn.getAttribute("aria-disabled")).toBe("true");
      expect(savingBtn.querySelector(".lucide-loader-circle")).not.toBeNull();

      // Settle the mutation.
      settle(
        resolveSave as unknown as (v: { ok: true }) => void,
        rejectSave as unknown as (e: Error) => void,
      );

      // Dialog closes on both success and error (onSettled clears
      // pendingFetlifeConfirm), so confirm/cancel unmount cleanly.
      await waitFor(() => {
        expect(screen.queryByRole("alertdialog")).toBeNull();
      });

      // No lingering "Saving…" button and no Loader2 spinner anywhere on
      // the page — the loading indicator has fully cleared.
      expect(screen.queryByRole("button", { name: /saving…/i })).toBeNull();
      expect(document.querySelector(".lucide-loader-circle")).toBeNull();

      // The form Save button is back to its idle state: label "Save" and
      // not disabled, so the admin can immediately retry or edit further.
      const formSave = screen.getAllByRole(
        "button",
        { name: /^save$/i },
      )[0]! as HTMLButtonElement;
      expect(formSave.disabled).toBe(false);
      expect(formSave.textContent?.trim()).toBe("Save");

      // Re-opening the confirm dialog (still-dirty draft) must show
      // fully-enabled confirm and cancel buttons with no spinner —
      // proving `saveInFlightRef` / `save.isPending` both cleared.
      fireEvent.click(formSave);
      const reopened = await screen.findByRole("alertdialog");
      const reopenedConfirm = within(reopened).getByRole("button", {
        name: /yes, update handle/i,
      }) as HTMLButtonElement;
      const reopenedCancel = within(reopened).getByRole("button", {
        name: /keep current handle/i,
      }) as HTMLButtonElement;
      expect(reopenedConfirm.getAttribute("aria-disabled")).not.toBe("true");
      expect(reopenedConfirm.getAttribute("aria-busy")).not.toBe("true");
      expect(reopenedConfirm.querySelector(".lucide-loader-circle")).toBeNull();
      expect(reopenedCancel.getAttribute("aria-disabled")).not.toBe("true");
    },
  );
});

describe("admin settings — FetLife handle client-side normalization + validation", () => {
  // The Save button is disabled while `fetlifeError` is truthy, but keyboard
  // Enter and programmatic submits (Retry save) still reach the submit
  // handler. These tests drive the form via `fireEvent.submit` to bypass the
  // disabled button and guarantee the handler is the last line of defence:
  // invalid input toasts an error, never opens the dialog, never calls the
  // server. Valid pasted input is normalized into the input on submit.

  function getFetlifeForm() {
    const input = screen.getByDisplayValue(SAVED.fetlife_handle);
    const form = input.closest("form");
    if (!form) throw new Error("FetLife form not found");
    return { input: input as HTMLInputElement, form };
  }

  it.each([
    ["whitespace-only", "     ", /required/i],
    ["too short", "ab", /at least/i],
    ["contains a space", "bad handle", /letters, digits/i],
    ["contains illegal character", "bad!chars", /letters, digits/i],
    ["URL that strips to empty", "https://fetlife.com/", /required/i],
  ])(
    "blocks Save and toasts when the handle is %s",
    async (_label, value, expectedMessage) => {
      renderPage();
      await waitForFormLoaded();

      const { input, form } = getFetlifeForm();
      fireEvent.change(input, { target: { value } });
      fireEvent.submit(form);

      // No dialog, no server call.
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(mockUpdateSiteSettings).not.toHaveBeenCalled();

      // The last error toast surfaces the validator's reason.
      const errorCalls = mockToast.error.mock.calls;
      expect(errorCalls.length).toBeGreaterThan(0);
      const [title, opts] = errorCalls[errorCalls.length - 1]!;
      expect(String(title)).toMatch(/fix the fetlife handle/i);
      expect(String((opts as { description?: string }).description)).toMatch(
        expectedMessage,
      );

      // Focus returns to the FetLife input so the admin can immediately fix
      // and retry — critical for keyboard + screen-reader users who would
      // otherwise be stranded on the (disabled) Save button.
      await waitFor(() => {
        expect(document.activeElement).toBe(input);
      });

      // The inline error is announced by an aria-live region.
      const errorRegion = document.getElementById("fetlife-handle-error");
      expect(errorRegion).not.toBeNull();
      expect(errorRegion!.getAttribute("role")).toBe("alert");
      expect(errorRegion!.getAttribute("aria-live")).toBe("polite");
      expect(errorRegion!.textContent ?? "").toMatch(expectedMessage);
      expect(input.getAttribute("aria-errormessage")).toBe("fetlife-handle-error");
      expect(input.getAttribute("aria-invalid")).toBe("true");
    },
  );

  it("normalizes a pasted profile URL into the input on submit before opening the dialog", async () => {
    renderPage();
    await waitForFormLoaded();

    const { input, form } = getFetlifeForm();
    fireEvent.change(input, {
      target: { value: "  https://www.fetlife.com/Pasted-Handle/photos?ref=x  " },
    });
    fireEvent.submit(form);

    // Dialog opens with the normalized value…
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getAllByText(/Pasted-Handle/)[0]).toBeTruthy();

    // …and the input has been rewritten to the normalized handle so what the
    // admin sees is exactly what the confirm dialog is about to save.
    expect((screen.getByDisplayValue("Pasted-Handle") as HTMLInputElement).value).toBe(
      "Pasted-Handle",
    );
    expect(mockUpdateSiteSettings).not.toHaveBeenCalled();
  });

  it("does not open the dialog when whitespace trims back to the saved handle", async () => {
    renderPage();
    await waitForFormLoaded();

    const { input, form } = getFetlifeForm();
    // Padding-only edit — normalizes to the same saved value.
    fireEvent.change(input, {
      target: { value: `   ${SAVED.fetlife_handle}   ` },
    });
    fireEvent.submit(form);

    // No confirmation dialog (nothing effectively changed) and the save
    // fires straight through with the unchanged handle.
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => {
      expect(mockUpdateSiteSettings).toHaveBeenCalledTimes(1);
    });
    const call = mockUpdateSiteSettings.mock.calls[0]![0] as {
      data: typeof SAVED;
    };
    expect(call.data.fetlife_handle).toBe(SAVED.fetlife_handle);
  });
});




describe("admin settings — FetLife confirmation dialog updates live", () => {
  // The dialog previews both the currently-live URL (from server data) and
  // the new URL derived from the draft input. The old URL is a snapshot of
  // what visitors see today and must never change while the admin is
  // editing. The new URL must track the normalized handle in real time as
  // the admin types or pastes different formats — otherwise the admin is
  // making a decision from a stale preview.

  // Helper: open the confirm dialog with an initial edit and return the
  // dialog + input handles for follow-up interactions.
  async function openDialogWithEdit(initialValue: string) {
    renderPage();
    await waitForFormLoaded();
    const fetInput = screen.getByDisplayValue(
      SAVED.fetlife_handle,
    ) as HTMLInputElement;
    fireEvent.change(fetInput, { target: { value: initialValue } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);
    const dialog = await screen.findByRole("alertdialog");
    return { dialog, fetInput };
  }

  // Assert the "Currently live" section still points at the SAVED handle
  // and the "New (unsaved)" section shows `expectedNewHandle`.
  function assertDialogUrls(
    dialog: HTMLElement,
    expectedNewHandle: string,
  ) {
    const savedUrl = `https://fetlife.com/${SAVED.fetlife_handle}`;
    const newUrl = `https://fetlife.com/${expectedNewHandle}`;

    // Old URL: rendered as a link with the saved handle in the href.
    const oldLink = within(dialog).getByRole("link", {
      name: savedUrl,
    }) as HTMLAnchorElement;
    expect(oldLink.getAttribute("href")).toBe(savedUrl);

    // New URL: rendered as a link with the normalized handle in the href.
    const newLink = within(dialog).getByRole("link", {
      name: newUrl,
    }) as HTMLAnchorElement;
    expect(newLink.getAttribute("href")).toBe(newUrl);
  }

  it("updates the new URL preview as the admin types successive characters", async () => {
    // Start with a valid handle so the confirm dialog opens (Save is gated
    // on `!fetlifeError` — a 1-char draft never gets us past that check).
    const { dialog, fetInput } = await openDialogWithEdit("Abc");
    assertDialogUrls(dialog, "Abc");

    // Type more characters (all remain within the min/max bounds) and
    // assert the dialog's new-URL preview tracks the input on every change.
    for (const value of ["Abcd", "Abcd-", "Abcd-1", "Abcd-12"]) {
      fireEvent.change(fetInput, { target: { value } });
      await waitFor(() => assertDialogUrls(dialog, value));
    }
  });

  // Each raw paste — every FetLife URL / handle format the admin might
  // paste — must normalize to the same canonical handle in the dialog
  // preview, while the old URL stays pinned to SAVED.fetlife_handle.
  it.each([
    ["Kinky-Pasted-Handle"],
    ["  Kinky-Pasted-Handle  "],
    ["@Kinky-Pasted-Handle"],
    ["https://fetlife.com/Kinky-Pasted-Handle"],
    ["http://fetlife.com/Kinky-Pasted-Handle"],
    ["https://www.fetlife.com/Kinky-Pasted-Handle"],
    ["https://fetlife.com/Kinky-Pasted-Handle/photos"],
    ["https://fetlife.com/Kinky-Pasted-Handle?ref=x"],
  ])(
    "normalizes pasted format %j live in the dialog preview",
    async (raw) => {
      const { dialog } = await openDialogWithEdit(raw);
      assertDialogUrls(dialog, "Kinky-Pasted-Handle");
    },
  );

  it("disables Save and hides the new URL link when the pasted value normalizes to an invalid handle", async () => {
    const { dialog, fetInput } = await openDialogWithEdit("Good-Handle");
    assertDialogUrls(dialog, "Good-Handle");

    // Paste a URL that strips to an empty handle — the new URL link must
    // disappear (rendered as "(empty)") and Save must be disabled.
    fireEvent.change(fetInput, {
      target: { value: "https://fetlife.com/" },
    });
    await waitFor(() => {
      // "(empty)" appears twice when the handle strips to nothing — once
      // on the Handle line and once where the new-URL link used to sit.
      expect(within(dialog).getAllByText(/^\(empty\)$/i).length).toBeGreaterThanOrEqual(1);
    });
    // Only the "Currently live" URL is linked — the new-URL block is gone.
    // Both the URL text and the "Open" affordance point to the same href,
    // so we assert on the unique href set rather than raw link count.
    const savedUrl = `https://fetlife.com/${SAVED.fetlife_handle}`;
    const fetlifeHrefs = new Set(
      within(dialog)
        .getAllByRole("link")
        .map((el) => el.getAttribute("href") ?? "")
        .filter((h) => h.startsWith("https://fetlife.com/")),
    );
    expect([...fetlifeHrefs]).toEqual([savedUrl]);

    const confirmBtn = within(dialog).getByRole("button", {
      name: /yes, update handle/i,
    }) as HTMLButtonElement;
    expect(confirmBtn.getAttribute("aria-disabled")).toBe("true");

    // Typing a valid handle back in re-enables Save and restores the link.
    fireEvent.change(fetInput, { target: { value: "Recovered-Handle" } });
    await waitFor(() => assertDialogUrls(dialog, "Recovered-Handle"));
    expect(
      (within(dialog).getByRole("button", {
        name: /yes, update handle/i,
      }) as HTMLButtonElement).getAttribute("aria-disabled"),
    ).not.toBe("true");
  });

  it("renders an Open-in-new-tab affordance next to BOTH the current and new FetLife URLs", async () => {
    renderPage();
    await waitForFormLoaded();

    const fetInput = screen.getByDisplayValue(SAVED.fetlife_handle);
    fireEvent.change(fetInput, { target: { value: "Reviewable-Handle" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^save$/i })[0]!);

    const dialog = await screen.findByRole("alertdialog");

    // Both Open affordances render, each pointing at its own URL, opening
    // in a new tab with hardened `rel` so window.opener can't be hijacked.
    const openCurrent = within(dialog).getByRole("link", {
      name: /open current fetlife url in a new tab/i,
    });
    const openNew = within(dialog).getByRole("link", {
      name: /open new fetlife url in a new tab/i,
    });
    expect(openCurrent.getAttribute("href")).toBe(
      `https://fetlife.com/${SAVED.fetlife_handle}`,
    );
    expect(openNew.getAttribute("href")).toBe(
      "https://fetlife.com/Reviewable-Handle",
    );
    for (const link of [openCurrent, openNew]) {
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toContain("noopener");
      expect(link.getAttribute("rel")).toContain("noreferrer");
      expect(link.textContent?.toLowerCase()).toContain("open");
    }
  });
});



