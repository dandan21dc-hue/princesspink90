import { createFileRoute, Link, useNavigate, getRouteApi } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Loader2, Check, Copy } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { amIAdmin } from "@/lib/admin.functions";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import {
  getSiteSettings,
  updateSiteSettings,
  listPricingAudit,
  exportPricingAudit,
  listContactSettingsAudit,
  type PricingAuditEntry,
  type PricingAuditSortColumn,
  type ContactSettingsAuditEntry,
  SESSION_PRICE_MIN_CENTS,
  SESSION_PRICE_MAX_CENTS,
  SESSION_DURATION_MIN_MINUTES,
  SESSION_DURATION_MAX_MINUTES,
  SESSION_PRICE_DEFAULT_CENTS,
  SESSION_DURATION_DEFAULT_MINUTES,
  normalizeFetlifeHandle,
  validateFetlifeHandle,
  validateContactEmail,
} from "@/lib/settings.functions";
import {
  getReminderJobConfig,
  updateReminderJobConfig,
} from "@/lib/reminder-job-config.functions";
// Stripe removed — NOWPayments is the only payment provider.
import { RoleGuard } from "@/components/RoleGuard";

const auditSearchSchema = z.object({
  q: fallback(z.string(), "").default(""),
  from: fallback(z.string(), "").default(""),
  to: fallback(z.string(), "").default(""),
  page: fallback(z.number().int(), 1).default(1),
  pageSize: fallback(z.number().int(), 10).default(10),
});

export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Site settings · Admin" }] }),
  validateSearch: zodValidator(auditSearchSchema),
  component: AdminSettingsGuarded,
});

// Pull the server's contact-email validation message out of a rejected save.
// Zod-in-serverFn errors serialize as an Error whose .message is a JSON string
// of issues (each { path, message }); some other server errors are plain
// strings. We show the first message whose path targets "email", or fall back
// to a plain-string message that mentions the email field.
function extractEmailValidationMessage(err: unknown): string | null {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    const issues = Array.isArray(parsed) ? parsed : parsed?.issues;
    if (Array.isArray(issues)) {
      const hit = issues.find(
        (i) => Array.isArray(i?.path) && i.path.includes("email") && typeof i.message === "string",
      );
      if (hit) return hit.message;
    }
  } catch {
    // not JSON — fall through to string heuristic
  }
  return /\bemail\b/i.test(raw) ? raw : null;
}


const routeApi = getRouteApi("/_authenticated/admin/settings");

function AdminSettingsGuarded() {
  return (
    <RoleGuard allowedRoles={["admin"]} redirectTo="/dashboard" message="Admin access required">
      <AdminSettings />
    </RoleGuard>
  );
}

export function AdminSettings() {
  const meFn = useServerFn(amIAdmin);
  const getFn = useServerFn(getSiteSettings);
  const updateFn = useServerFn(updateSiteSettings);
  const qc = useQueryClient();

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const settings = useQuery({
    queryKey: ["site-settings"],
    queryFn: () => getFn(),
    enabled: me.data?.isAdmin === true,
  });

  const [email, setEmail] = useState("");
  const [fetlife, setFetlife] = useState("");
  const [reddit, setReddit] = useState("");
  const [gloryHolesEnabled, setGloryHolesEnabled] = useState(true);
  const [sessionPriceDollars, setSessionPriceDollars] = useState("275");
  const [sessionDurationMinutes, setSessionDurationMinutes] = useState(60);
  const [saved, setSaved] = useState(false);
  // Server-side validation error extracted for the contact-email field.
  // Populated in the mutation's onError when the server rejects the email;
  // cleared as the admin edits the field or a save succeeds.
  const [serverEmailError, setServerEmailError] = useState<string | null>(null);
  // Server-side rejection for the FetLife handle. Populated when a confirmed
  // save fails so we can echo the exact message inline under the input
  // (alongside the toast); cleared on edit or on a successful save.
  const [serverFetlifeError, setServerFetlifeError] = useState<string | null>(null);

  useEffect(() => {
    if (settings.data) {
      setEmail(settings.data.email);
      setFetlife(settings.data.fetlife_handle);
      setReddit(settings.data.reddit_handle);
      setGloryHolesEnabled(settings.data.glory_holes_enabled);
      setSessionPriceDollars((settings.data.session_price_cents / 100).toFixed(2));
      setSessionDurationMinutes(settings.data.session_duration_minutes);
    }
  }, [settings.data]);

  const priceDollarsNum = parseFloat(sessionPriceDollars);
  const priceCents = Math.round(priceDollarsNum * 100);
  const priceMinDollars = SESSION_PRICE_MIN_CENTS / 100;
  const priceMaxDollars = SESSION_PRICE_MAX_CENTS / 100;

  let priceError: string | null = null;
  if (sessionPriceDollars.trim() === "" || !Number.isFinite(priceDollarsNum)) {
    priceError = "Session price is required and must be a number.";
  } else if (priceCents < SESSION_PRICE_MIN_CENTS) {
    priceError = `Session price must be at least A$${priceMinDollars.toFixed(2)}.`;
  } else if (priceCents > SESSION_PRICE_MAX_CENTS) {
    priceError = `Session price must be at most A$${priceMaxDollars.toFixed(2)}.`;
  }

  let durationError: string | null = null;
  if (!Number.isFinite(sessionDurationMinutes)) {
    durationError = "Session duration is required and must be a number.";
  } else if (!Number.isInteger(sessionDurationMinutes)) {
    durationError = "Session duration must be a whole number of minutes.";
  } else if (sessionDurationMinutes < SESSION_DURATION_MIN_MINUTES) {
    durationError = `Session duration must be at least ${SESSION_DURATION_MIN_MINUTES} minutes.`;
  } else if (sessionDurationMinutes > SESSION_DURATION_MAX_MINUTES) {
    durationError = `Session duration must be at most ${SESSION_DURATION_MAX_MINUTES} minutes.`;
  }

  // Mirror the server-side rule (contactSettingsUpdateSchema.email) so the
  // form catches bad addresses before we hit the RPC.
  const emailTrimmed = email.trim();
  const emailError = validateContactEmail(email);


  const fetlifeNormalized = normalizeFetlifeHandle(fetlife);
  const fetlifeError = validateFetlifeHandle(fetlife);

  // The dialog renders the URL from `fetlifeNormalized`. Round-trip parse it
  // back to a handle so we can prove the visible URL still maps to the value
  // we're about to save — catches any drift between the preview and the
  // normalized handle (whitespace, case, stray path segments) before the
  // admin confirms. Save is disabled when the URL is missing or mismatched.
  const newFetlifeUrl = fetlifeNormalized
    ? `https://fetlife.com/${fetlifeNormalized}`
    : "";
  const fetlifeUrlMatchesHandle = (() => {
    if (!fetlifeNormalized) return false;
    try {
      const u = new URL(newFetlifeUrl);
      if (u.host.toLowerCase() !== "fetlife.com") return false;
      const handleFromUrl = u.pathname.replace(/^\/+|\/+$/g, "");
      return handleFromUrl === fetlifeNormalized;
    } catch {
      return false;
    }
  })();
  const fetlifeConfirmBlocked =
    fetlifeError !== null || !fetlifeUrlMatchesHandle;

  const sessionInputsInvalid =
    priceError !== null ||
    durationError !== null ||
    emailError !== null ||
    fetlifeError !== null;

  // Tracks whether the most-recent save attempt included a FetLife handle
  // change, so onError can surface a FetLife-specific failure toast.
  const lastAttemptFetlifeChangeRef = useRef<{
    changed: boolean;
    oldHandle: string | null;
    newHandle: string | null;
  } | null>(null);

  const save = useMutation({
    mutationFn: () => {
      if (emailError) throw new Error(emailError);
      if (fetlifeError) throw new Error(fetlifeError);
      if (priceError) throw new Error(priceError);
      if (durationError) throw new Error(durationError);
      const nextValues = {
        email: emailTrimmed,
        fetlife_handle: fetlifeNormalized,
        reddit_handle: reddit,
        glory_holes_enabled: gloryHolesEnabled,
        session_price_cents: priceCents,
        session_duration_minutes: sessionDurationMinutes,
      };
      // Compare against the last-loaded server state so the success toast can
      // list exactly which fields actually changed.
      const prev = settings.data;
      const changes: string[] = [];
      if (prev) {
        if (prev.email !== nextValues.email) {
          changes.push(`Contact email → ${nextValues.email}`);
        }
        if (prev.fetlife_handle !== nextValues.fetlife_handle) {
          changes.push(`FetLife handle → ${nextValues.fetlife_handle}`);
        }
        if (prev.reddit_handle !== nextValues.reddit_handle) {
          changes.push(`Reddit handle → ${nextValues.reddit_handle}`);
        }
        if (prev.glory_holes_enabled !== nextValues.glory_holes_enabled) {
          changes.push(
            `Glory Holes booking page → ${nextValues.glory_holes_enabled ? "Enabled" : "Disabled"}`,
          );
        }
        if (prev.session_price_cents !== nextValues.session_price_cents) {
          changes.push(
            `Session price → A$${(nextValues.session_price_cents / 100).toFixed(2)}`,
          );
        }
        if (prev.session_duration_minutes !== nextValues.session_duration_minutes) {
          changes.push(
            `Session duration → ${nextValues.session_duration_minutes} min`,
          );
        }
      }
      // The FetLife confirmation dialog gates this mutation on the client;
      // the server also re-checks by comparing the submitted handle against
      // the stored value, so we pass the flag whenever the handle changed.
      const fetlifeChanging =
        !!prev && prev.fetlife_handle !== nextValues.fetlife_handle;
      lastAttemptFetlifeChangeRef.current = {
        changed: fetlifeChanging,
        oldHandle: prev?.fetlife_handle ?? null,
        newHandle: nextValues.fetlife_handle,
      };
      return updateFn({
        data: { ...nextValues, fetlife_confirmed: fetlifeChanging },
      }).then((res) => ({ res, changes }));
    },
    onSuccess: ({ changes }) => {
      setSaved(true);
      setServerEmailError(null);
      setServerFetlifeError(null);
      qc.invalidateQueries({ queryKey: ["site-settings"] });
      qc.invalidateQueries({ queryKey: ["glory-holes-enabled"] });
      qc.invalidateQueries({ queryKey: ["session-pricing"] });
      qc.invalidateQueries({ queryKey: ["pricing-audit"] });
      qc.invalidateQueries({ queryKey: ["contact-settings-audit"] });
      if (changes.length === 0) {
        toast.success("Settings saved", {
          description: "No fields changed — everything was already up to date.",
        });
      } else {
        toast.success(
          `Settings saved — ${changes.length} field${changes.length === 1 ? "" : "s"} updated`,
          {
            description: (
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs">
                {changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ),
            duration: 6000,
          },
        );
      }
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err) => {
      setServerEmailError(extractEmailValidationMessage(err));
      const message = err instanceof Error ? err.message : "Please try again.";
      const attemptForInline = lastAttemptFetlifeChangeRef.current;
      if (attemptForInline?.changed) setServerFetlifeError(message);
      const attempt = lastAttemptFetlifeChangeRef.current;
      if (attempt?.changed) {
        // Ship a monitoring event so recurring FetLife save failures are
        // visible outside the admin's session. We include the field name,
        // the error message, and the old/new handles (public identifiers,
        // not PII) plus their lengths — no email, no auth tokens, no
        // session inputs, no full settings payload.
        reportLovableError(err instanceof Error ? err : new Error(message), {
          source: "admin_settings_fetlife_save",
          field: "fetlife_handle",
          error_message: message,
          old_handle: attempt.oldHandle,
          new_handle: attempt.newHandle,
          old_handle_length: attempt.oldHandle?.length ?? 0,
          new_handle_length: attempt.newHandle?.length ?? 0,
        });
        // FetLife-specific failure toast: name the field explicitly, echo the
        // full server error, and remind the admin what the public link still
        // points to so they know the homepage is unaffected.
        toast.error("Couldn't save FetLife handle", {
          description: `${message} — public link still points to ${attempt.oldHandle ?? "(none)"}.`,
          duration: 8000,
          action: {
            label: "Retry",
            // Re-attempt the save directly. The mutation's own onSuccess /
            // onError handlers will surface the follow-up toast, so we don't
            // need to duplicate that here.
            onClick: () => {
              if (save.isPending) return;
              save.reset();
              save.mutate();
            },
          },
        });
        // Send focus back to the handle input so the admin can immediately
        // edit and retry — the field is where the failure happened.
        // Send focus back to the handle input so the admin can immediately
        // edit and retry — the field is where the failure happened. Defer
        // past Radix's own focus restore (which returns focus to the Save
        // trigger when the confirm dialog closes on the failed save).
        setTimeout(() => fetlifeInputRef.current?.focus(), 0);
      } else {
        toast.error("Couldn't save settings", { description: message });
      }
    },
  });


  // Confirmation gate for FetLife handle changes. Because that value drives
  // the public profile link, a typo is user-visible — we require the admin
  // to explicitly confirm the old → new change before the save actually runs.
  const [pendingFetlifeConfirm, setPendingFetlifeConfirm] = useState(false);
  // Distinguishes an intentional confirm/cancel button click from a dialog
  // dismissal (Esc / overlay). We only toast on the latter two — confirming
  // proceeds to the save toast instead.
  const fetlifeDismissIntentRef = useRef<"confirm" | "cancel" | null>(null);
  // The Save button opens the confirm dialog programmatically. Radix only
  // auto-restores focus to its own <Trigger>, so we hold a ref to Save and
  // return focus there after the dialog closes — otherwise keyboard users
  // land back at document.body.
  const saveButtonRef = useRef<HTMLButtonElement | null>(null);
  // Return keyboard focus to the FetLife input after a validation or server
  // rejection so the admin can fix and retry without hunting for the field.
  const fetlifeInputRef = useRef<HTMLInputElement | null>(null);
  // Double-submit guard. `save.isPending` only flips true on the next React
  // render, so two synchronous clicks (fast double-click, keyboard repeat,
  // Ctrl+Enter racing a click) both see the stale `false` and each fire a
  // separate `save.mutate()` — two requests, two audit rows. This ref flips
  // synchronously the moment we call `mutate`, and is cleared in `onSettled`
  // so a retry after failure still works.
  const saveInFlightRef = useRef(false);
  const startSave = (opts?: Parameters<typeof save.mutate>[1]) => {
    if (saveInFlightRef.current || save.isPending) return false;
    saveInFlightRef.current = true;
    save.mutate(undefined, {
      ...opts,
      onSettled: (data, error, vars, ctx) => {
        saveInFlightRef.current = false;
        opts?.onSettled?.(data, error, vars, ctx);
      },
    });
    return true;
  };
  const fetlifeConfirmDialogId = "fetlife-confirm-dialog";
  const fetlifeChanged =
    settings.data != null && settings.data.fetlife_handle !== fetlifeNormalized;

  const handleSubmit = () => {
    // Flush any pending normalization (e.g. trimming whitespace, stripping a
    // pasted profile URL) into the input state so the admin sees the exact
    // value that's about to be validated and — if valid — saved.
    const normalized = normalizeFetlifeHandle(fetlife);
    if (normalized !== fetlife) setFetlife(normalized);

    // Explicit re-validation before opening the confirm dialog. The Save
    // button is disabled while `fetlifeError` is truthy, but keyboard Enter
    // on the form and programmatic submits (e.g. Retry save) can still land
    // here — so we block invalid handles here rather than trusting the UI
    // state alone.
    const validationError = validateFetlifeHandle(normalized);
    if (validationError) {
      toast.error("Fix the FetLife handle first", {
        description: validationError,
      });
      // Return focus so the admin can immediately edit — the inline error
      // is announced by its role="alert" span.
      fetlifeInputRef.current?.focus();
      fetlifeInputRef.current?.select();
      return;
    }


    // Recompute the "changed" check against the freshly-normalized value so
    // an admin who typed extra whitespace but kept the same handle doesn't
    // get an unnecessary confirmation dialog.
    const changedAfterNormalize =
      settings.data != null && settings.data.fetlife_handle !== normalized;
    if (changedAfterNormalize) {
      setPendingFetlifeConfirm(true);
      // Explain up-front why Save didn't persist immediately — the AlertDialog
      // is modal but easy to miss on wide screens, and the FetLife handle
      // drives a public URL where a silent typo is costly.
      toast("Confirmation required", {
        description:
          "Review the old and new FetLife URLs in the dialog, then confirm to save.",
      });

      return;
    }
    save.mutate();
  };








  if (me.isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          You don't have admin access.{" "}
          <Link to="/dashboard" className="text-primary underline">Back to dashboard</Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-sm text-muted-foreground">
        These values appear on the public homepage under "Your host".
      </p>
      <form
        className="mt-6 space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
      >
        <Field label="Contact email">
          <input
            type="email"
            required
            maxLength={255}
            value={email}
            aria-invalid={emailError !== null || serverEmailError !== null}
            onChange={(e) => {
              setEmail(e.target.value);
              // Editing dismisses any prior server-side rejection for this field.
              if (serverEmailError) setServerEmailError(null);
            }}
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${
              emailError || serverEmailError ? "border-destructive" : "border-border"
            }`}
          />
          {emailError ? (
            <div className="mt-1 text-[11px] text-destructive">{emailError}</div>
          ) : serverEmailError ? (
            <div className="mt-1 text-[11px] text-destructive">
              Server rejected this email: {serverEmailError}
            </div>
          ) : null}
        </Field>

        <Field
          label="FetLife handle"
          hint="3-20 characters: letters, digits, underscore, or hyphen. Pasting a full profile URL is fine — it will be normalized."
        >
          <input
            ref={fetlifeInputRef}
            required
            maxLength={100}
            value={fetlife}
            aria-invalid={fetlifeError !== null || serverFetlifeError !== null}
            aria-errormessage={
              fetlifeError || serverFetlifeError ? "fetlife-handle-error" : undefined
            }
            onChange={(e) => {
              setFetlife(e.target.value);
              // Editing dismisses any prior server-side rejection for this field.
              if (serverFetlifeError) setServerFetlifeError(null);
            }}
            onBlur={() => setFetlife((v) => normalizeFetlifeHandle(v))}
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${
              fetlifeError || serverFetlifeError ? "border-destructive" : "border-border"
            }`}
          />
          {/* role="alert" + aria-live announce the error the moment it appears
              (typed input, or after a server rejection focuses the field). */}
          <div
            id="fetlife-handle-error"
            role="alert"
            aria-live="polite"
            className="mt-1 text-[11px] text-destructive"
          >
            {fetlifeError ?? (serverFetlifeError ? `Server rejected this handle: ${serverFetlifeError}` : "")}
          </div>
        </Field>
        <ContactLinkPreview
          draftEmail={emailError ? null : emailTrimmed}
          draftFetlife={fetlifeError ? null : fetlifeNormalized}
          savedEmail={settings.data?.email ?? null}
          savedFetlife={settings.data?.fetlife_handle ?? null}
        />
        <Field label="Reddit handle" hint="Without u/ prefix, e.g. 19pink-princess90">
          <input
            required
            maxLength={100}
            value={reddit}
            onChange={(e) => setReddit(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field
          label="Glory Holes booking page"
          hint="When disabled, the public /glory-holes page shows an 'Unavailable' notice instead of the booking form."
        >
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={gloryHolesEnabled}
              onChange={(e) => setGloryHolesEnabled(e.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            <span>{gloryHolesEnabled ? "Enabled — page is live" : "Disabled — page is hidden"}</span>
          </label>
        </Field>
        <div className="rounded-md border border-border/60 bg-muted/30 p-4">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">
            Session pricing
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Shown on the Private Room and Glory Holes booking pages. Note: the amount charged at
            checkout is still controlled by your Stripe price catalogue — keep those in sync.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field
              label="Active session price (AUD)"
              hint={`Between A$${priceMinDollars.toFixed(2)} and A$${priceMaxDollars.toFixed(2)}. e.g. 275.00`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">A$</span>
                <input
                  type="number"
                  min={priceMinDollars}
                  max={priceMaxDollars}
                  step="0.01"
                  required
                  inputMode="decimal"
                  aria-invalid={priceError !== null}
                  value={sessionPriceDollars}
                  onChange={(e) => setSessionPriceDollars(e.target.value)}
                  className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${
                    priceError ? "border-destructive" : "border-border"
                  }`}
                />
              </div>
              {priceError && (
                <div className="mt-1 text-[11px] text-destructive">{priceError}</div>
              )}
            </Field>
            <Field
              label="Session duration (minutes)"
              hint={`Between ${SESSION_DURATION_MIN_MINUTES} and ${SESSION_DURATION_MAX_MINUTES} minutes. e.g. 60`}
            >
              <input
                type="number"
                min={SESSION_DURATION_MIN_MINUTES}
                max={SESSION_DURATION_MAX_MINUTES}
                step={5}
                required
                inputMode="numeric"
                aria-invalid={durationError !== null}
                value={sessionDurationMinutes}
                onChange={(e) => setSessionDurationMinutes(Number(e.target.value))}
                className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${
                  durationError ? "border-destructive" : "border-border"
                }`}
              />
              {durationError && (
                <div className="mt-1 text-[11px] text-destructive">{durationError}</div>
              )}
            </Field>
          </div>
          <BookingPricingPreview
            savedPriceCents={settings.data?.session_price_cents ?? null}
            savedDurationMinutes={settings.data?.session_duration_minutes ?? null}
            draftPriceCents={priceError ? null : priceCents}
            draftDurationMinutes={durationError ? null : sessionDurationMinutes}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            ref={saveButtonRef}
            type="submit"
            disabled={save.isPending || settings.isLoading || sessionInputsInvalid}
            aria-haspopup={fetlifeChanged && !fetlifeError ? "dialog" : undefined}
            aria-expanded={fetlifeChanged && !fetlifeError ? pendingFetlifeConfirm : undefined}
            aria-controls={
              fetlifeChanged && !fetlifeError ? fetlifeConfirmDialogId : undefined
            }
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold uppercase tracking-widest text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={() => {
              if (settings.data) {
                setEmail(settings.data.email);
                setFetlife(settings.data.fetlife_handle);
                setReddit(settings.data.reddit_handle);
                setGloryHolesEnabled(settings.data.glory_holes_enabled);
                setSessionPriceDollars((settings.data.session_price_cents / 100).toFixed(2));
                setSessionDurationMinutes(settings.data.session_duration_minutes);
              }
              setSaved(false);
            }}
            disabled={save.isPending || settings.isLoading || !settings.data}
            className="rounded-md border border-border bg-background px-5 py-2 text-sm font-semibold uppercase tracking-widest text-foreground hover:bg-muted disabled:opacity-50"
          >
            Reset changes
          </button>
          <button
            type="button"
            onClick={() => {
              setSessionPriceDollars((SESSION_PRICE_DEFAULT_CENTS / 100).toFixed(2));
              setSessionDurationMinutes(SESSION_DURATION_DEFAULT_MINUTES);
              setSaved(false);
            }}
            disabled={save.isPending}
            className="rounded-md border border-border bg-background px-5 py-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground hover:bg-muted disabled:opacity-50"
            title={`Restore session price to A$${(SESSION_PRICE_DEFAULT_CENTS / 100).toFixed(2)} and duration to ${SESSION_DURATION_DEFAULT_MINUTES} min`}
          >
            Reset session defaults
          </button>

          {saved && <span className="text-sm text-primary">Saved ✓</span>}
          {save.error && (
            <div className="flex flex-wrap items-center gap-2">
              <span role="alert" className="text-sm text-destructive">
                {(save.error as Error).message}
              </span>
              <button
                type="button"
                onClick={() => {
                  save.reset();
                  handleSubmit();
                }}
                disabled={save.isPending || sessionInputsInvalid}
                className="rounded-md border border-destructive/60 bg-destructive/10 px-3 py-1 text-xs font-semibold uppercase tracking-widest text-destructive hover:bg-destructive/20 disabled:opacity-50"
              >
                Retry save
              </button>
            </div>
          )}

        </div>
      </form>

      <ContactSettingsAuditSection />
      <PricingAuditSection />
      <ReminderJobConfigSection />
      {/* Stripe catalogue sync / subscription refresh sections removed. */}
      <AlertDialog
        open={pendingFetlifeConfirm}
        onOpenChange={(open) => {
          if (open) return;
          // While the confirm-triggered save is in flight, block Radix from
          // closing the dialog (Esc, overlay click, programmatic close). The
          // buttons themselves are disabled — closing would strand the admin
          // with no visible "saving…" indicator.
          if (save.isPending) return;
          const intent = fetlifeDismissIntentRef.current;
          fetlifeDismissIntentRef.current = null;
          setPendingFetlifeConfirm(false);
          if (intent !== "confirm") {
            // Dialog dismissed without confirming (Cancel button, Esc, or
            // overlay click) — revert the input to the last saved value so
            // the visible draft matches what's actually live, and surface a
            // toast so the admin isn't left wondering whether the FetLife
            // change went through.
            const savedHandle = settings.data?.fetlife_handle ?? "";
            setFetlife(savedHandle);
            toast("FetLife handle change not saved", {
              description: `Kept current handle: ${savedHandle || "(none)"}`,
            });
          }
          // Return keyboard focus to the Save button that opened the dialog.
          // Radix only auto-restores focus to its own <Trigger>, and we open
          // this dialog programmatically. Defer to the next frame so Radix
          // has finished tearing down its focus scope first.
          requestAnimationFrame(() => {
            saveButtonRef.current?.focus();
          });
        }}
      >

        <AlertDialogContent
          id={fetlifeConfirmDialogId}
          aria-describedby={`${fetlifeConfirmDialogId}-desc`}
          // Radix's FocusScope traps Tab/Shift+Tab inside this content while
          // the dialog is open and restores focus to the previously-focused
          // element on close. We open the dialog programmatically (no Radix
          // <Trigger>), so onOpenChange also focuses `saveButtonRef` as a
          // belt-and-braces restore. Do not add manual keydown Tab handling
          // — it would double up on the built-in trap and cause focus jumps.
          onOpenAutoFocus={(event) => {
            // AlertDialog's default is to focus the Cancel button, which is
            // the safer choice for a destructive-adjacent action. Explicitly
            // preserve that behaviour and make it inspectable.
            event.preventDefault();
            const root = event.currentTarget as HTMLElement | null;
            const cancelBtn = root?.querySelector<HTMLButtonElement>("[data-cancel]");
            cancelBtn?.focus();
          }}
          onEscapeKeyDown={(event) => {
            // While the save is in flight, swallow Escape so the admin can't
            // dismiss the dialog mid-request and lose the loading indicator.
            if (save.isPending) {
              event.preventDefault();
              return;
            }
            // Radix closes the dialog on Escape by default; mark the intent
            // as an explicit cancel so onOpenChange takes the "not saved"
            // toast path rather than inferring it from a null ref.
            fetlifeDismissIntentRef.current = "cancel";
          }}
          onKeyDown={(event) => {
            // Ctrl/Cmd+Enter = power-user shortcut to confirm without moving
            // focus onto the destructive action first. Plain Enter still
            // activates whichever button currently has focus (Radix default).
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              if (save.isPending || fetlifeConfirmBlocked) return;
              fetlifeDismissIntentRef.current = "confirm";
              save.mutate(undefined, {
                onSettled: () => setPendingFetlifeConfirm(false),
              });
            }
          }}
        >


          <AlertDialogHeader>
            <AlertDialogTitle>Confirm FetLife handle change</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div id={`${fetlifeConfirmDialogId}-desc`} className="space-y-2 text-sm">
                <p>
                  This updates the public profile link on the homepage. A typo
                  here sends visitors to the wrong (or a missing) FetLife
                  profile.
                </p>
                <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 font-mono text-xs">
                  <div>
                    <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                      Currently live
                    </div>
                    <div className="mt-0.5">
                      <span className="text-muted-foreground">Handle:</span>{" "}
                      {settings.data?.fetlife_handle ?? "(none)"}
                    </div>
                    <div className="break-all">
                      <span className="text-muted-foreground">URL:</span>{" "}
                      {settings.data?.fetlife_handle ? (
                        <>
                          <a
                            href={`https://fetlife.com/${settings.data.fetlife_handle}`}
                            target="_blank"
                            rel="noreferrer"
                            className="underline hover:text-foreground"
                          >
                            https://fetlife.com/{settings.data.fetlife_handle}
                          </a>
                          <CopyUrlButton
                            value={`https://fetlife.com/${settings.data.fetlife_handle}`}
                            label="Copy current FetLife URL"
                          />
                        </>
                      ) : (
                        <span className="text-muted-foreground">(none)</span>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-border/60 pt-2">
                    <div className="text-[10px] uppercase tracking-widest text-primary">
                      New (unsaved)
                    </div>
                    <div className="mt-0.5">
                      <span className="text-muted-foreground">Handle:</span>{" "}
                      <span className="font-semibold text-foreground">
                        {fetlifeNormalized || "(empty)"}
                      </span>
                    </div>
                    <div className="break-all">
                      <span className="text-muted-foreground">URL:</span>{" "}
                      {fetlifeNormalized ? (
                        <>
                          <a
                            href={newFetlifeUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-primary underline"
                          >
                            {newFetlifeUrl}
                          </a>
                          <CopyUrlButton
                            value={newFetlifeUrl}
                            label="Copy new FetLife URL"
                          />
                        </>
                      ) : (
                        <span className="text-destructive">(empty)</span>
                      )}
                    </div>
                  </div>
                  {fetlifeConfirmBlocked && (
                    <div
                      role="alert"
                      className="rounded-md border border-destructive/50 bg-destructive/10 p-2 font-sans text-xs text-destructive"
                    >
                      {fetlifeError
                        ? fetlifeError
                        : !fetlifeNormalized
                          ? "Enter a FetLife handle before saving."
                          : "The preview URL doesn't match the normalized handle — fix the handle and try again."}
                    </div>
                  )}
                  <div className="border-t border-border/60 pt-2 text-[10px] uppercase tracking-widest text-muted-foreground/80">
                    Tip: press Esc to cancel, or Ctrl/⌘+Enter to confirm.
                  </div>
                  {/*
                    aria-live region: announces the normalized new URL (or the
                    current validation error) whenever the admin edits the
                    handle while the confirm dialog is open. `polite` avoids
                    interrupting; `atomic` re-reads the whole message on every
                    change so partial edits don't produce fragmentary output.
                    Sighted users already see the preview update inline — this
                    mirrors that feedback for screen-reader users, who would
                    otherwise have to re-navigate the dialog after every
                    keystroke to hear the current URL.
                  */}
                  <div
                    aria-live="polite"
                    aria-atomic="true"
                    className="sr-only"
                  >
                    {fetlifeError
                      ? `FetLife handle invalid: ${fetlifeError}`
                      : fetlifeNormalized
                        ? `New FetLife URL: ${newFetlifeUrl}`
                        : "New FetLife URL is empty."}
                  </div>
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              data-cancel
              disabled={save.isPending}
              onClick={(event) => {
                if (save.isPending) {
                  event.preventDefault();
                  return;
                }
                fetlifeDismissIntentRef.current = "cancel";
              }}
            >
              Keep current handle
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={save.isPending || fetlifeConfirmBlocked}
              aria-busy={save.isPending || undefined}
              aria-disabled={save.isPending || fetlifeConfirmBlocked || undefined}
              onClick={(event) => {
                // Prevent Radix's default close-on-click so the dialog stays
                // open with a loading state until the mutation settles.
                event.preventDefault();
                if (save.isPending || fetlifeConfirmBlocked) return;
                fetlifeDismissIntentRef.current = "confirm";
                save.mutate(undefined, {
                  onSettled: () => setPendingFetlifeConfirm(false),
                });
              }}
            >
              {save.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Yes, update handle"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </Shell>
  );
}

function CopyUrlButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);
  const onCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        // Fallback for browsers without async clipboard API.
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "absolute";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      toast.success("URL copied to clipboard");
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy URL");
    }
  };
  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={label}
      title={label}
      className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded border border-border/60 align-middle text-muted-foreground hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      {copied ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : (
        <Copy className="h-3 w-3" aria-hidden />
      )}
    </button>
  );
}

function ContactLinkPreview({
  draftEmail,
  draftFetlife,
  savedEmail,
  savedFetlife,
}: {
  draftEmail: string | null;
  draftFetlife: string | null;
  savedEmail: string | null;
  savedFetlife: string | null;
}) {
  const mailto = draftEmail ? `mailto:${draftEmail}` : null;
  const fetUrl = draftFetlife ? `https://fetlife.com/${draftFetlife}` : null;
  const emailChanged = draftEmail !== null && savedEmail !== null && draftEmail !== savedEmail;
  const fetChanged =
    draftFetlife !== null && savedFetlife !== null && draftFetlife !== savedFetlife;
  const anyChange = emailChanged || fetChanged;
  return (
    <div className="rounded-md border border-border/60 bg-muted/30 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Live public link preview
        </div>
        {anyChange ? (
          <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
            Unsaved changes
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Matches saved
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Exactly what the homepage's "Your host" card will link to after Save.
      </p>
      <dl className="mt-3 space-y-2 text-sm">
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Email link
          </dt>
          <dd className={`mt-0.5 break-all font-mono text-xs ${emailChanged ? "text-primary font-semibold" : ""}`}>
            {mailto ? (
              <a href={mailto} className="hover:underline">{mailto}</a>
            ) : (
              <span className="text-destructive">Fix the email field to preview</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
            FetLife profile URL
          </dt>
          <dd className={`mt-0.5 break-all font-mono text-xs ${fetChanged ? "text-primary font-semibold" : ""}`}>
            {fetUrl ? (
              <a href={fetUrl} target="_blank" rel="noreferrer" className="hover:underline">
                {fetUrl}
              </a>
            ) : (
              <span className="text-destructive">Fix the FetLife handle to preview</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function formatAud(cents: number): string {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    minimumFractionDigits: 2,
  }).format(cents / 100);
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

function BookingPricingPreview({
  savedPriceCents,
  savedDurationMinutes,
  draftPriceCents,
  draftDurationMinutes,
}: {
  savedPriceCents: number | null;
  savedDurationMinutes: number | null;
  draftPriceCents: number | null;
  draftDurationMinutes: number | null;
}) {
  const sampleQuantities = [1, 2, 3];
  const hasDraft = draftPriceCents !== null && draftDurationMinutes !== null;
  const hasSaved = savedPriceCents !== null && savedDurationMinutes !== null;
  const priceChanged = hasDraft && hasSaved && draftPriceCents !== savedPriceCents;
  const durationChanged =
    hasDraft && hasSaved && draftDurationMinutes !== savedDurationMinutes;
  const anyChange = priceChanged || durationChanged;

  return (
    <div className="mt-4 rounded-md border border-border/60 bg-background/60 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <div className="text-xs uppercase tracking-widest text-muted-foreground">
          Live booking preview
        </div>
        {hasDraft ? (
          anyChange ? (
            <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
              Unsaved changes
            </span>
          ) : (
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Matches saved
            </span>
          )
        ) : (
          <span className="text-[10px] uppercase tracking-widest text-destructive">
            Fix errors to preview
          </span>
        )}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Sample bookings computed from the values in the form above. Nothing is
        saved yet — click Save to publish these prices to the booking pages.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-widest text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Sample booking</th>
              <th className="py-2 pr-3 font-medium">Total duration</th>
              <th className="py-2 pr-3 font-medium">Draft total</th>
              <th className="py-2 font-medium">Currently saved</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {sampleQuantities.map((qty) => {
              const draftTotalCents = hasDraft ? draftPriceCents! * qty : null;
              const draftTotalMinutes = hasDraft ? draftDurationMinutes! * qty : null;
              const savedTotalCents = hasSaved ? savedPriceCents! * qty : null;
              const savedTotalMinutes = hasSaved ? savedDurationMinutes! * qty : null;
              const totalChanged =
                draftTotalCents !== null &&
                savedTotalCents !== null &&
                draftTotalCents !== savedTotalCents;
              const durTotalChanged =
                draftTotalMinutes !== null &&
                savedTotalMinutes !== null &&
                draftTotalMinutes !== savedTotalMinutes;
              return (
                <tr key={qty} className="align-top">
                  <td className="py-2 pr-3">
                    {qty} × session
                  </td>
                  <td className={`py-2 pr-3 ${durTotalChanged ? "text-primary font-semibold" : ""}`}>
                    {draftTotalMinutes !== null ? formatDuration(draftTotalMinutes) : "—"}
                  </td>
                  <td className={`py-2 pr-3 ${totalChanged ? "text-primary font-semibold" : ""}`}>
                    {draftTotalCents !== null ? formatAud(draftTotalCents) : "—"}
                  </td>
                  <td className="py-2 text-muted-foreground">
                    {savedTotalCents !== null && savedTotalMinutes !== null
                      ? `${formatAud(savedTotalCents)} · ${formatDuration(savedTotalMinutes)}`
                      : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hasDraft && (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 text-xs text-muted-foreground">
          <div>
            Per-minute rate:{" "}
            <span className="text-foreground font-medium">
              {draftDurationMinutes! > 0
                ? `${formatAud(Math.round(draftPriceCents! / draftDurationMinutes!))} / min`
                : "—"}
            </span>
          </div>
          <div>
            Per-hour rate:{" "}
            <span className="text-foreground font-medium">
              {draftDurationMinutes! > 0
                ? `${formatAud(Math.round((draftPriceCents! * 60) / draftDurationMinutes!))} / hr`
                : "—"}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}




function ReminderJobConfigSection() {
  const getFn = useServerFn(getReminderJobConfig);
  const updateFn = useServerFn(updateReminderJobConfig);
  const qc = useQueryClient();

  const config = useQuery({
    queryKey: ["reminder-job-config"],
    queryFn: () => getFn(),
  });

  const [time, setTime] = useState("08:00");
  const [days, setDays] = useState<number>(7);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config.data) {
      setTime(config.data.daily_run_time_utc);
      setDays(config.data.expiring_within_days);
    }
  }, [config.data]);

  const save = useMutation({
    mutationFn: () =>
      updateFn({
        data: { daily_run_time_utc: time, expiring_within_days: days },
      }),
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["reminder-job-config"] });
      setTimeout(() => setSaved(false), 2500);
    },
  });

  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="font-display text-xl font-bold">Reminder job</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure when the daily reminder job runs and how far in advance guests
        are notified of expiring health screenings. Defaults: 08:00 UTC, 7 days
        before expiry.
      </p>
      <form
        className="mt-5 space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Daily run time (UTC)" hint="24-hour HH:MM, e.g. 08:00">
          <input
            type="time"
            required
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field
          label="Expiring within (days)"
          hint="How many days before expiry to send the reminder (1–90)."
        >
          <input
            type="number"
            required
            min={1}
            max={90}
            step={1}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="w-40 rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending || config.isLoading}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-sm text-primary">Saved ✓</span>}
          {save.error && (
            <span className="text-sm text-destructive">
              {(save.error as Error).message}
            </span>
          )}
        </div>
        {config.data?.updated_at && (
          <p className="text-[11px] text-muted-foreground">
            Last updated {new Date(config.data.updated_at).toLocaleString()}.
            Note: the cron schedule itself is managed by the platform — update it
            there to match the run time above.
          </p>
        )}
      </form>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
      {hint && <div className="mt-1 text-[11px] text-muted-foreground">{hint}</div>}
    </label>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="font-display text-3xl font-bold">Site settings</h1>
        <Link to="/dashboard" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Dashboard
        </Link>
      </div>
      {children}
    </main>
  );
}

function PricingAuditSection() {
  const listFn = useServerFn(listPricingAudit);
  const exportFn = useServerFn(exportPricingAudit);
  const navigate = useNavigate({ from: "/_authenticated/admin/settings" });
  const { q: search, from, to, page, pageSize } = routeApi.useSearch();
  const [exportError, setExportError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [searchInput, setSearchInput] = useState(search);
  const [sortBy, setSortBy] = useState<PricingAuditSortColumn>("changed_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const updateSearch = (
    patch: Partial<{ q: string; from: string; to: string; page: number; pageSize: number }>,
  ) => {
    navigate({
      search: (prev: Record<string, unknown>) => {
        const next = { ...prev, ...patch };
        // Any filter change resets to page 1 unless the caller set page explicitly.
        if (patch.page === undefined && ("q" in patch || "from" in patch || "to" in patch || "pageSize" in patch)) {
          next.page = 1;
        }
        return next;
      },
      replace: true,
    });
  };

  // Keep local input in sync when URL changes (e.g. someone pastes a shared link).
  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  // Debounce email search input into the URL.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed === search) return;
    const t = setTimeout(() => {
      updateSearch({ q: trimmed });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const audit = useQuery({
    queryKey: ["pricing-audit", { search, from, to, page, pageSize, sortBy, sortDir }],
    queryFn: () => listFn({ data: { search, from, to, page, pageSize, sortBy, sortDir } }),
    placeholderData: (prev) => prev,
  });

  const toggleSort = (col: PricingAuditSortColumn) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir(col === "changed_by_email" ? "asc" : "desc");
    }
    updateSearch({ page: 1 });
  };

  const handleExport = async () => {
    setExportError(null);
    setIsExporting(true);
    try {
      const data = await exportFn({
        data: { search, from, to, sortBy, sortDir },
      });
      const csv = buildAuditCsv(data);
      const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      a.download = `pricing-audit-${stamp}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError((err as Error).message ?? "Export failed");
    } finally {
      setIsExporting(false);
    }
  };



  const rows = audit.data?.rows ?? [];
  const total = audit.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);
  const hasActiveFilter = search !== "" || from !== "" || to !== "";

  return (
    <section className="mt-12 border-t border-border pt-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Pricing change history</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every change to the session price or duration is recorded here with the admin who
            made it and the timestamp.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="rounded-md border border-border bg-background px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground hover:bg-muted disabled:opacity-50"
          >
            {isExporting ? "Preparing…" : "Download CSV"}
          </button>
          <span className="text-[11px] text-muted-foreground">
            Applies current filters &amp; sort
          </span>
          {exportError && (
            <span className="text-[11px] text-destructive">{exportError}</span>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            Search admin email
          </div>
          <input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="e.g. admin@example.com"
            maxLength={255}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            From date
          </div>
          <input
            type="date"
            value={from}
            onChange={(e) => updateSearch({ from: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            To date
          </div>
          <input
            type="date"
            value={to}
            onChange={(e) => updateSearch({ to: e.target.value })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            Rows per page
          </div>
          <select
            value={pageSize}
            onChange={(e) => updateSearch({ pageSize: Number(e.target.value) })}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>

      {hasActiveFilter && (
        <button
          type="button"
          onClick={() => {
            setSearchInput("");
            updateSearch({ q: "", from: "", to: "" });
          }}
          className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          Clear filters
        </button>
      )}

      {audit.error && (
        <p className="mt-4 text-sm text-destructive">
          {(audit.error as Error).message}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <SortableTh label="When" col="changed_at" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <SortableTh label="Admin" col="changed_by_email" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
              <th className="px-3 py-2 font-medium">
                <div className="flex items-center gap-3">
                  <SortHeaderButton label="Old price" col="old_session_price_cents" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                  <span className="text-muted-foreground/60">→</span>
                  <SortHeaderButton label="New price" col="new_session_price_cents" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                </div>
              </th>
              <th className="px-3 py-2 font-medium">
                <div className="flex items-center gap-3">
                  <SortHeaderButton label="Old duration" col="old_session_duration_minutes" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                  <span className="text-muted-foreground/60">→</span>
                  <SortHeaderButton label="New duration" col="new_session_duration_minutes" sortBy={sortBy} sortDir={sortDir} onToggle={toggleSort} />
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {audit.isLoading && rows.length === 0 &&
              Array.from({ length: Math.min(pageSize, 6) }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-t border-border/60">
                  <td className="px-3 py-3">
                    <div className="h-3 w-32 animate-pulse rounded bg-muted" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-3 w-40 animate-pulse rounded bg-muted" />
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-14 animate-pulse rounded bg-muted" />
                      <span className="text-muted-foreground/40">→</span>
                      <div className="h-3 w-14 animate-pulse rounded bg-muted" />
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-3">
                      <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                      <span className="text-muted-foreground/40">→</span>
                      <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                    </div>
                  </td>
                </tr>
              ))}
            {!audit.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8">
                  <AuditEmptyState
                    hasActiveFilter={hasActiveFilter}
                    search={search}
                    from={from}
                    to={to}
                    onClear={() => {
                      setSearchInput("");
                      updateSearch({ q: "", from: "", to: "" });
                    }}
                  />
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const priceChanged =
                row.old_session_price_cents !== row.new_session_price_cents;
              const durationChanged =
                row.old_session_duration_minutes !== row.new_session_duration_minutes;
              return (
                <tr key={row.id} className="border-t border-border/60">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                    {new Date(row.changed_at).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    {row.changed_by_email ?? row.changed_by ?? "—"}
                  </td>
                  <td className="px-3 py-2">
                    {priceChanged ? (
                      <span>
                        {formatCents(row.old_session_price_cents)}{" "}
                        <span className="text-muted-foreground">→</span>{" "}
                        <span className="font-semibold">
                          {formatCents(row.new_session_price_cents)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {formatCents(row.new_session_price_cents)}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {durationChanged ? (
                      <span>
                        {formatMinutes(row.old_session_duration_minutes)}{" "}
                        <span className="text-muted-foreground">→</span>{" "}
                        <span className="font-semibold">
                          {formatMinutes(row.new_session_duration_minutes)}
                        </span>
                      </span>
                    ) : (
                      <span className="text-muted-foreground">
                        {formatMinutes(row.new_session_duration_minutes)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>
          {total === 0
            ? "0 records"
            : `Showing ${showingFrom}–${showingTo} of ${total}`}
          {audit.isFetching && !audit.isLoading ? " · updating…" : ""}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateSearch({ page: Math.max(1, page - 1) })}
            disabled={page <= 1 || audit.isLoading}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          >
            ← Prev
          </button>
          <span>
            Page {page} / {totalPages}
          </span>
          <button
            type="button"
            onClick={() => updateSearch({ page: Math.min(totalPages, page + 1) })}
            disabled={page >= totalPages || audit.isLoading}
            className="rounded-md border border-border px-3 py-1 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      </div>
    </section>
  );
}

function AuditEmptyState({
  hasActiveFilter,
  search,
  from,
  to,
  onClear,
}: {
  hasActiveFilter: boolean;
  search: string;
  from: string;
  to: string;
  onClear: () => void;
}) {
  if (!hasActiveFilter) {
    return (
      <div className="flex flex-col items-center gap-2 text-center">
        <div className="text-sm font-semibold text-foreground">No pricing changes yet</div>
        <p className="max-w-md text-xs text-muted-foreground">
          Every save to the session price or duration will be recorded here with the admin
          who made the change and the exact timestamp.
        </p>
      </div>
    );
  }

  const activeFilters: string[] = [];
  if (search) activeFilters.push(`admin email contains "${search}"`);
  if (from && to) activeFilters.push(`between ${from} and ${to}`);
  else if (from) activeFilters.push(`on or after ${from}`);
  else if (to) activeFilters.push(`on or before ${to}`);

  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <div className="text-sm font-semibold text-foreground">
        No pricing changes match your filters
      </div>
      <p className="max-w-md text-xs text-muted-foreground">
        Nothing was found where {activeFilters.join(" and ")}. Try widening the date range,
        clearing the email search, or removing filters entirely.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-foreground hover:bg-muted"
      >
        Clear filters
      </button>
    </div>
  );
}

function formatCents(cents: number | null): string {
  if (cents == null) return "—";
  return `A$${(cents / 100).toFixed(2)}`;
}

function formatMinutes(mins: number | null): string {
  if (mins == null) return "—";
  return `${mins} min`;
}

type SortToggleProps = {
  label: string;
  col: PricingAuditSortColumn;
  sortBy: PricingAuditSortColumn;
  sortDir: "asc" | "desc";
  onToggle: (col: PricingAuditSortColumn) => void;
};

function SortIndicator({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) {
    return <span aria-hidden className="ml-1 text-muted-foreground/40">↕</span>;
  }
  return (
    <span aria-hidden className="ml-1 text-primary">
      {dir === "asc" ? "▲" : "▼"}
    </span>
  );
}

function SortHeaderButton({ label, col, sortBy, sortDir, onToggle }: SortToggleProps) {
  const active = sortBy === col;
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className={`inline-flex items-center uppercase tracking-widest ${
        active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      <SortIndicator active={active} dir={sortDir} />
    </button>
  );
}

function SortableTh({ label, col, sortBy, sortDir, onToggle }: SortToggleProps) {
  const active = sortBy === col;
  return (
    <th
      scope="col"
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      className="px-3 py-2 font-medium"
    >
      <SortHeaderButton
        label={label}
        col={col}
        sortBy={sortBy}
        sortDir={sortDir}
        onToggle={onToggle}
      />
    </th>
  );
}

function csvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildAuditCsv(rows: PricingAuditEntry[]): string {
  const headers = [
    "Changed at (ISO)",
    "Admin email",
    "Admin user id",
    "Old price (AUD)",
    "New price (AUD)",
    "Old duration (min)",
    "New duration (min)",
  ];
  const lines = [headers.map(csvCell).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.changed_at,
        r.changed_by_email,
        r.changed_by,
        r.old_session_price_cents != null ? (r.old_session_price_cents / 100).toFixed(2) : "",
        r.new_session_price_cents != null ? (r.new_session_price_cents / 100).toFixed(2) : "",
        r.old_session_duration_minutes,
        r.new_session_duration_minutes,
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\r\n");
}

function ContactSettingsAuditSection() {
  const listFn = useServerFn(listContactSettingsAudit);
  const audit = useQuery({
    queryKey: ["contact-settings-audit"],
    queryFn: () => listFn(),
  });

  const rows: ContactSettingsAuditEntry[] = audit.data ?? [];

  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="font-display text-xl font-bold">Contact details change history</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every change to the public contact email or FetLife handle is recorded here with the
        admin who made it and the exact timestamp. Showing the most recent 100 changes.
      </p>

      {audit.error && (
        <p className="mt-4 text-sm text-destructive">
          {(audit.error as Error).message}
        </p>
      )}

      <div className="mt-4 overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-xs">
          <thead className="bg-muted/40 text-[11px] uppercase tracking-widest text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">When</th>
              <th scope="col" className="px-3 py-2 font-medium">Admin</th>
              <th scope="col" className="px-3 py-2 font-medium">Field</th>
              <th scope="col" className="px-3 py-2 font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {audit.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Loading…
                </td>
              </tr>
            )}
            {!audit.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center">
                  <div className="text-sm font-semibold text-foreground">
                    No contact detail changes yet
                  </div>
                  <p className="mx-auto mt-2 max-w-md text-xs text-muted-foreground">
                    Saving a new contact email or FetLife handle above will record an entry here.
                  </p>
                </td>
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border/60 align-top">
                <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">
                  {new Date(row.changed_at).toLocaleString()}
                </td>
                <td className="px-3 py-2">
                  {row.actor_email ?? row.actor_id ?? "—"}
                </td>
                <td className="px-3 py-2">
                  {row.field === "email" ? "Contact email" : "FetLife handle"}
                </td>
                <td className="px-3 py-2">
                  <span className="break-all text-muted-foreground">
                    {row.old_value ?? <em>(unset)</em>}
                  </span>{" "}
                  <span className="text-muted-foreground">→</span>{" "}
                  <span className="break-all font-semibold">
                    {row.new_value ?? <em>(unset)</em>}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}




