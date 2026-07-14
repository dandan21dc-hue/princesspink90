import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { amIAdmin } from "@/lib/admin.functions";
import {
  getSiteSettings,
  updateSiteSettings,
  listPricingAudit,
  exportPricingAudit,
  type PricingAuditEntry,
  type PricingAuditSortColumn,
  SESSION_PRICE_MIN_CENTS,
  SESSION_PRICE_MAX_CENTS,
  SESSION_DURATION_MIN_MINUTES,
  SESSION_DURATION_MAX_MINUTES,
} from "@/lib/settings.functions";
import {
  getReminderJobConfig,
  updateReminderJobConfig,
} from "@/lib/reminder-job-config.functions";
import { syncMissingStripePrices, convertTermPassesToOneTime, archiveUsdPrices } from "@/lib/stripeMaintenance.functions";
import { refreshUserSubscriptionStatus } from "@/lib/admin.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { RoleGuard } from "@/components/RoleGuard";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  head: () => ({ meta: [{ title: "Site settings · Admin" }] }),
  component: AdminSettingsGuarded,
});

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

  const sessionInputsInvalid = priceError !== null || durationError !== null;

  const save = useMutation({
    mutationFn: () => {
      if (priceError) throw new Error(priceError);
      if (durationError) throw new Error(durationError);
      return updateFn({
        data: {
          email,
          fetlife_handle: fetlife,
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
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
        <Field label="FetLife handle" hint="Without leading slash, e.g. pink_princess90">
          <input
            required
            maxLength={100}
            value={fetlife}
            onChange={(e) => setFetlife(e.target.value)}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </Field>
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
        </div>
        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={save.isPending || settings.isLoading || sessionInputsInvalid}
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
      </form>

      <PricingAuditSection />
      <ReminderJobConfigSection />
      <StripeCatalogueSyncSection />
      <ManualSubscriptionRefreshSection />
    </Shell>
  );
}

function ManualSubscriptionRefreshSection() {
  const refreshFn = useServerFn(refreshUserSubscriptionStatus);
  const [query, setQuery] = useState("");
  const run = useMutation({
    mutationFn: (q: string) =>
      refreshFn({ data: { userIdOrEmail: q, environment: getStripeEnvironment() } }),
  });

  const data = run.data;
  const summary =
    data && "ok" in data && data.ok
      ? `Synced ${data.updated} / ${data.subscriptionsFound} subscription${
          data.subscriptionsFound === 1 ? "" : "s"
        } for ${data.email ?? data.userId}`
      : null;
  const errorMsg =
    data && "ok" in data && !data.ok ? data.error : run.error ? (run.error as Error).message : null;

  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="font-display text-xl font-bold">Manually refresh subscription status</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Force-syncs a user's subscription rows from Stripe in the current
        environment ({getStripeEnvironment()}). Use this when a
        <code className="mx-1 rounded bg-muted px-1 py-0.5 text-[11px]">customer.subscription.*</code>
        webhook was missed. One-time purchases and term-pass memberships are
        provisioned at checkout and are not affected by this action.
      </p>
      <form
        className="mt-4 flex flex-wrap items-center gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!query.trim()) return;
          run.mutate(query.trim());
        }}
      >
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="User id (uuid) or email"
          className="min-w-[280px] flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={run.isPending || !query.trim()}
          className="min-h-10 rounded-md bg-primary px-5 py-2 text-sm font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          {run.isPending ? "Refreshing…" : "Refresh status"}
        </button>
      </form>
      {summary && <p className="mt-3 text-sm text-primary">{summary}</p>}
      {errorMsg && <p className="mt-3 text-sm text-destructive">{errorMsg}</p>}
    </section>
  );
}

function StripeCatalogueSyncSection() {
  const syncFn = useServerFn(syncMissingStripePrices);
  const run = useMutation({
    mutationFn: () => syncFn({ data: { environment: getStripeEnvironment() } }),
  });

  const data = run.data;
  const summary =
    data && "results" in data
      ? `${data.created} created · ${data.existed} already present · ${data.errors} error${data.errors === 1 ? "" : "s"}`
      : null;

  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="font-display text-xl font-bold">Stripe catalogue sync</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Creates any missing Stripe product/price for the expected all-access and
        lifetime lookup_keys in the current environment ({getStripeEnvironment()}).
        Existing prices are never modified — this only fills gaps so checkout
        never fails with "Price not found".
      </p>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="rounded-md bg-primary px-5 py-2 text-sm font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50"
        >
          {run.isPending ? "Syncing…" : "Sync missing prices"}
        </button>
        {summary && <span className="text-sm text-muted-foreground">{summary}</span>}
        {run.error && (
          <span className="text-sm text-destructive">
            {(run.error as Error).message}
          </span>
        )}
      </div>
      {data && "error" in data && (
        <p className="mt-3 text-sm text-destructive">{data.error}</p>
      )}
      {data && "results" in data && data.results.length > 0 && (
        <ul className="mt-4 space-y-1 text-xs font-mono">
          {data.results.map((r) => {
            const tone =
              r.status === "created"
                ? "text-primary"
                : r.status === "error"
                ? "text-destructive"
                : "text-muted-foreground";
            const detail =
              r.status === "created"
                ? `created (${r.priceId})`
                : r.status === "exists"
                ? `exists (${r.priceId})`
                : r.status === "skipped"
                ? `skipped — ${r.reason}`
                : `error — ${r.message}`;
            return (
              <li key={r.lookupKey} className={tone}>
                <span className="mr-2">•</span>
                {r.lookupKey}: {detail}
              </li>
            );
          })}
        </ul>
      )}
      <ConvertTermPassesSection />
      <ArchiveUsdPricesSection />

    </section>
  );
}

function ConvertTermPassesSection() {
  const convertFn = useServerFn(convertTermPassesToOneTime);
  const run = useMutation({
    mutationFn: () => convertFn({ data: { environment: getStripeEnvironment() } }),
  });
  const data = run.data;
  const summary =
    data && "results" in data
      ? `${data.converted} converted · ${data.results.filter((r) => r.status === "already_one_time").length} already one-time · ${data.results.filter((r) => r.status === "error").length} error(s)`
      : null;

  return (
    <div className="mt-8 border-t border-border/60 pt-6">
      <h3 className="font-display text-lg font-semibold">Convert term passes to one-time</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        The 3/6/12-month term passes are lump-sum upfront purchases (A$27 / A$48 / A$84).
        If they still exist as recurring monthly prices in Stripe, this action archives the
        legacy price and creates a one-time replacement, transferring the same lookup_key.
        Safe to re-run — already-converted plans are skipped.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="rounded-md border border-primary/60 bg-primary/10 px-5 py-2 text-sm font-semibold uppercase tracking-widest text-primary disabled:opacity-50"
        >
          {run.isPending ? "Converting…" : "Convert term passes"}
        </button>
        {summary && <span className="text-sm text-muted-foreground">{summary}</span>}
        {run.error && (
          <span className="text-sm text-destructive">{(run.error as Error).message}</span>
        )}
      </div>
      {data && "error" in data && (
        <p className="mt-3 text-sm text-destructive">{data.error}</p>
      )}
      {data && "results" in data && data.results.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs font-mono">
          {data.results.map((r) => {
            const tone =
              r.status === "converted"
                ? "text-primary"
                : r.status === "error"
                ? "text-destructive"
                : "text-muted-foreground";
            const detail =
              r.status === "converted"
                ? `converted ${r.oldPriceId} → ${r.newPriceId}`
                : r.status === "already_one_time"
                ? `already one-time (${r.priceId})`
                : r.status === "missing"
                ? "no active price in Stripe — run sync first"
                : `error — ${r.message}`;
            return (
              <li key={r.lookupKey} className={tone}>
                <span className="mr-2">•</span>
                {r.lookupKey}: {detail}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ArchiveUsdPricesSection() {
  const archiveFn = useServerFn(archiveUsdPrices);
  const run = useMutation({
    mutationFn: () => archiveFn({ data: { environment: getStripeEnvironment() } }),
  });
  const data = run.data;
  const summary =
    data && "archived" in data
      ? `${data.archived} archived · ${data.alreadyInactive} already inactive · ${data.scanned} prices scanned`
      : null;

  return (
    <div className="mt-8 border-t border-border/60 pt-6">
      <h3 className="font-display text-lg font-semibold">Archive legacy USD prices</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        Walks every active price in Stripe ({getStripeEnvironment()}) and deactivates any denominated in USD.
        AUD is the only supported surface currency; any USD price is legacy and unsafe to leave active.
        Safe to re-run — already-inactive prices are counted but not touched.
      </p>
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => run.mutate()}
          disabled={run.isPending}
          className="rounded-md border border-destructive/60 bg-destructive/10 px-5 py-2 text-sm font-semibold uppercase tracking-widest text-destructive disabled:opacity-50"
        >
          {run.isPending ? "Archiving…" : "Archive USD prices"}
        </button>
        {summary && <span className="text-sm text-muted-foreground">{summary}</span>}
        {run.error && (
          <span className="text-sm text-destructive">{(run.error as Error).message}</span>
        )}
      </div>
      {data && "error" in data && (
        <p className="mt-3 text-sm text-destructive">{data.error}</p>
      )}
      {data && "details" in data && data.details.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs font-mono">
          {data.details.map((d) => (
            <li key={d.priceId} className="text-muted-foreground">
              <span className="mr-2">•</span>
              {d.priceId}
              {d.lookupKey ? ` (${d.lookupKey})` : ""}
              {d.productId ? ` — ${d.productId}` : ""}
              {d.amount != null ? ` · ${(d.amount / 100).toFixed(2)} USD` : ""}
            </li>
          ))}
        </ul>
      )}
      {data && "details" in data && data.details.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No USD prices found — catalogue is clean.</p>
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
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortBy, setSortBy] = useState<PricingAuditSortColumn>("changed_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Debounce email search input.
  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
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
      // Default: newest/highest first for numeric+date; A→Z for text.
      setSortDir(col === "changed_by_email" ? "asc" : "desc");
    }
    setPage(1);
  };

  const rows = audit.data?.rows ?? [];
  const total = audit.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const showingFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const showingTo = Math.min(page * pageSize, total);
  const hasActiveFilter = search !== "" || from !== "" || to !== "";

  return (
    <section className="mt-12 border-t border-border pt-8">
      <h2 className="font-display text-xl font-bold">Pricing change history</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Every change to the session price or duration is recorded here with the admin who
        made it and the timestamp.
      </p>

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
            onChange={(e) => {
              setFrom(e.target.value);
              setPage(1);
            }}
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
            onChange={(e) => {
              setTo(e.target.value);
              setPage(1);
            }}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block">
          <div className="mb-1 text-[11px] uppercase tracking-widest text-muted-foreground">
            Rows per page
          </div>
          <select
            value={pageSize}
            onChange={(e) => {
              setPageSize(Number(e.target.value));
              setPage(1);
            }}
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
            setSearch("");
            setFrom("");
            setTo("");
            setPage(1);
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
            {audit.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-sm text-muted-foreground">
                  Loading history…
                </td>
              </tr>
            )}
            {!audit.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-4 text-sm text-muted-foreground">
                  {hasActiveFilter
                    ? "No changes match your filters."
                    : "No changes recorded yet."}
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
            onClick={() => setPage((p) => Math.max(1, p - 1))}
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
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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


