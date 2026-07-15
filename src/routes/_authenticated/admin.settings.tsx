import { createFileRoute, Link, useNavigate, getRouteApi } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { amIAdmin } from "@/lib/admin.functions";
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

const routeApi = getRouteApi("/_authenticated/admin/settings");

function AdminSettingsGuarded() {
  return (
    <RoleGuard allowedRoles={["admin"]} redirectTo="/dashboard" message="Admin access required">
      <AdminSettings />
    </RoleGuard>
  );
}

function AdminSettings() {
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

  // Mirror the server-side rule (z.string().trim().email().max(255)) so the
  // form catches bad addresses before we hit the RPC.
  const emailTrimmed = email.trim();
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  let emailError: string | null = null;
  if (emailTrimmed === "") {
    emailError = "Contact email is required.";
  } else if (emailTrimmed.length > 255) {
    emailError = "Contact email must be 255 characters or fewer.";
  } else if (!emailRe.test(emailTrimmed)) {
    emailError = "Enter a valid email address (e.g. name@example.com).";
  }

  const fetlifeNormalized = normalizeFetlifeHandle(fetlife);
  const fetlifeError = validateFetlifeHandle(fetlife);

  const sessionInputsInvalid =
    priceError !== null ||
    durationError !== null ||
    emailError !== null ||
    fetlifeError !== null;

  const save = useMutation({
    mutationFn: () => {
      if (emailError) throw new Error(emailError);
      if (fetlifeError) throw new Error(fetlifeError);
      if (priceError) throw new Error(priceError);
      if (durationError) throw new Error(durationError);
      return updateFn({
        data: {
          email: emailTrimmed,
          fetlife_handle: fetlifeNormalized,
          reddit_handle: reddit,
          glory_holes_enabled: gloryHolesEnabled,
          session_price_cents: priceCents,
          session_duration_minutes: sessionDurationMinutes,
        },
      });
    },
    onSuccess: () => {
      setSaved(true);
      qc.invalidateQueries({ queryKey: ["site-settings"] });
      qc.invalidateQueries({ queryKey: ["glory-holes-enabled"] });
      qc.invalidateQueries({ queryKey: ["session-pricing"] });
      qc.invalidateQueries({ queryKey: ["pricing-audit"] });
      setTimeout(() => setSaved(false), 2500);
    },
  });


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
          save.mutate();
        }}
      >
        <Field label="Contact email">
          <input
            type="email"
            required
            maxLength={255}
            value={email}
            aria-invalid={emailError !== null}
            onChange={(e) => setEmail(e.target.value)}
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${
              emailError ? "border-destructive" : "border-border"
            }`}
          />
          {emailError && (
            <div className="mt-1 text-[11px] text-destructive">{emailError}</div>
          )}
        </Field>
        <Field
          label="FetLife handle"
          hint="3-20 characters: letters, digits, underscore, or hyphen. Pasting a full profile URL is fine — it will be normalized."
        >
          <input
            required
            maxLength={100}
            value={fetlife}
            aria-invalid={fetlifeError !== null}
            onChange={(e) => setFetlife(e.target.value)}
            onBlur={() => setFetlife((v) => normalizeFetlifeHandle(v))}
            className={`w-full rounded-md border bg-background px-3 py-2 text-sm ${
              fetlifeError ? "border-destructive" : "border-border"
            }`}
          />
          {fetlifeError && (
            <div className="mt-1 text-[11px] text-destructive">{fetlifeError}</div>
          )}
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
            type="submit"
            disabled={save.isPending || settings.isLoading || sessionInputsInvalid}
            className="rounded-md bg-primary px-5 py-2 text-sm font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
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
            <span className="text-sm text-destructive">
              {(save.error as Error).message}
            </span>
          )}
        </div>
      </form>

      <ContactSettingsAuditSection />
      <PricingAuditSection />
      <ReminderJobConfigSection />
      {/* Stripe catalogue sync / subscription refresh sections removed. */}
    </Shell>
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



