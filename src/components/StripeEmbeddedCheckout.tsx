import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { AlertCircle, RefreshCw } from "lucide-react";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createStoreCheckoutSession } from "@/lib/store.functions";
import { track } from "@/lib/track";
import { Skeleton } from "@/components/ui/skeleton";


interface Props {
  priceId?: string;
  contentItemId?: string;
  returnUrl?: string;
  userId?: string;
  customerEmail?: string;
  bookingStartsAt?: string;
  autoRenew?: boolean;
}

/**
 * Best-effort buyer-country detection via Cloudflare's trace endpoint.
 * Passed to the server so managed-payments routing / tax calculation
 * can localise. Falls back to undefined; server handles missing values.
 */
async function detectCountry(): Promise<string | undefined> {
  try {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", { cache: "no-store" });
    const text = await res.text();
    const match = /^loc=([A-Z]{2})/m.exec(text);
    return match?.[1];
  } catch {
    return undefined;
  }
}

// Watchdog: if Stripe hasn't mounted its iframe within this window, treat it as a load failure.
const MOUNT_TIMEOUT_MS = 15_000;

export function StripeEmbeddedCheckout(props: Props) {
  // Stable id for correlating all lifecycle events for a single mount attempt.
  const mountIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `mount_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
  );
  const mountedAtRef = useRef<number>(Date.now());

  // Derive checkout "kind" once for logging tags.
  const kind = props.priceId?.startsWith("panty_")
    ? "panty"
    : props.priceId
      ? "subscription"
      : props.contentItemId
        ? "content_item"
        : props.bookingStartsAt
          ? "private_room"
          : "unknown";
  const source = props.priceId ?? props.contentItemId ?? "unknown";

  const logLifecycle = useCallback(
    (event: string, extra?: Record<string, unknown>) => {
      const payload = {
        mount_id: mountIdRef.current,
        kind,
        source,
        environment: getStripeEnvironment(),
        elapsed_ms: Date.now() - mountedAtRef.current,
        ...extra,
      };
      track(`stripe_checkout_${event}`, payload);
      // eslint-disable-next-line no-console
      console.info(`[stripe-checkout] ${event}`, payload);
    },
    [kind, source],
  );

  // Keep country in a ref so async detection does NOT trigger a re-render.
  // Re-rendering hands EmbeddedCheckoutProvider a new `options.fetchClientSecret`,
  // which Stripe rejects ("You cannot change fetchClientSecret after setting it"),
  // and the checkout form never mounts.
  const [countryReady, setCountryReady] = useState(false);
  const countryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    logLifecycle("mount_started");
    const started = Date.now();
    logLifecycle("country_detect_started");
    detectCountry()
      .then((c) => {
        countryRef.current = c;
        logLifecycle("country_detect_completed", {
          country: c ?? null,
          detected: Boolean(c),
          duration_ms: Date.now() - started,
        });
      })
      .catch((e) => {
        logLifecycle("country_detect_failed", {
          message: (e as Error)?.message?.slice(0, 200),
          duration_ms: Date.now() - started,
        });
      })
      .finally(() => {
        setCountryReady(true);
      });
    return () => {
      logLifecycle("unmounted");
    };
    // Mount-once instrumentation; logLifecycle is stable per kind/source.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Latest props via ref so the memoized fetcher stays referentially stable
  // while still seeing the newest values when Stripe eventually invokes it.
  const propsRef = useRef(props);
  useEffect(() => {
    propsRef.current = props;
  });

  const [error, setError] = useState<string | null>(null);
  // Bumping this key remounts the provider with a fresh fetcher so retry works.
  const [attempt, setAttempt] = useState(0);
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Runtime guard: memoize the in-flight client-secret promise per attempt so
  // that any accidental re-invocation of fetchClientSecret (React StrictMode
  // double-invoke, provider re-render, upstream retry) returns the SAME
  // promise instead of opening a second Stripe Checkout Session. Stripe also
  // rejects fetcher swaps once the provider is initialized; this ref keeps the
  // reference stable across renders even if useCallback identity changes.
  const inFlightRef = useRef<{ attempt: number; promise: Promise<string> } | null>(null);

  const runFetchClientSecret = useCallback(async (): Promise<string> => {
    const p = propsRef.current;
    const requestStartedAt = Date.now();
    logLifecycle("session_request_started", {
      attempt,
      has_user: Boolean(p.userId),
      has_email: Boolean(p.customerEmail),
      country: countryRef.current ?? null,
      auto_renew: p.autoRenew ?? null,
      booking_starts_at: p.bookingStartsAt ?? null,
    });
    const fail = (reason: string, message?: string) => {
      const duration = Date.now() - requestStartedAt;
      track("stripe_checkout_session_failed", {
        mount_id: mountIdRef.current,
        attempt,
        kind,
        source,
        environment: getStripeEnvironment(),
        reason,
        duration_ms: duration,
        ...(message && { message: message.slice(0, 200) }),
      });
      logLifecycle("session_request_failed", { reason, duration_ms: duration, message: message?.slice(0, 200) });
    };
    let result;
    try {
      result = await createStoreCheckoutSession({
        data: {
          priceId: p.priceId,
          contentItemId: p.contentItemId,
          userId: p.userId,
          customerEmail: p.customerEmail,
          returnUrl: p.returnUrl || window.location.href,
          environment: getStripeEnvironment(),
          bookingStartsAt: p.bookingStartsAt,
          customerCountry: countryRef.current,
          autoRenew: p.autoRenew,
        },
      });
    } catch (e) {
      const msg = (e as Error)?.message ?? "Failed to start checkout";
      fail("exception", msg);
      setError(msg);
      throw e;
    }
    if ("error" in result) {
      fail("server_error", String(result.error));
      setError(String(result.error));
      throw new Error(result.error);
    }
    if (!result.clientSecret) {
      fail("no_client_secret");
      const msg = "Stripe did not return a client secret";
      setError(msg);
      throw new Error(msg);
    }
    logLifecycle("session_request_completed", {
      attempt,
      duration_ms: Date.now() - requestStartedAt,
    });
    setSessionLoaded(true);
    return result.clientSecret;
    // attempt is intentionally in deps so each retry creates a fresh fetcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, kind, source, logLifecycle]);

  const fetchClientSecret = useCallback((): Promise<string> => {
    const cached = inFlightRef.current;
    if (cached && cached.attempt === attempt) {
      logLifecycle("session_request_deduped", { attempt });
      return cached.promise;
    }
    const promise = runFetchClientSecret().catch((e) => {
      // On failure, drop the cache so the next explicit retry (attempt++)
      // starts fresh; keep it cached on success so the client secret is stable.
      if (inFlightRef.current?.attempt === attempt) inFlightRef.current = null;
      throw e;
    });
    inFlightRef.current = { attempt, promise };
    return promise;
  }, [attempt, logLifecycle, runFetchClientSecret]);

  // Guarantee referentially-stable options per attempt. `useMemo` alone is
  // best-effort (React may drop memos); a ref keyed by attempt makes the
  // "one options object per checkout session" contract explicit.
  const optionsRef = useRef<{
    attempt: number;
    value: { fetchClientSecret: () => Promise<string> };
  } | null>(null);
  if (!optionsRef.current || optionsRef.current.attempt !== attempt) {
    optionsRef.current = { attempt, value: { fetchClientSecret } };
  }
  const options = optionsRef.current.value;


  // Fail loudly if Stripe.js itself doesn't load (blocked, offline, bad key).
  const stripePromise = useMemo(() => {
    const initStartedAt = Date.now();
    logLifecycle("provider_init_started", { attempt });
    const p = getStripe();
    p.then((s) => {
      const duration = Date.now() - initStartedAt;
      if (!s) {
        logLifecycle("provider_init_failed", { reason: "stripe_null", duration_ms: duration });
        setError("Stripe failed to load. Check your connection or ad blockers and try again.");
      } else {
        logLifecycle("provider_init_completed", { duration_ms: duration });
      }
    }).catch((e) => {
      const msg = (e as Error)?.message?.slice(0, 200);
      logLifecycle("provider_init_failed", {
        reason: "exception",
        duration_ms: Date.now() - initStartedAt,
        message: msg,
      });
      setError((e as Error)?.message ?? "Stripe failed to load.");
    });
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);



  // Watchdog: if no iframe appears in the checkout container within the timeout,
  // treat it as a mount failure so the user isn't stuck on a blank spinner.
  useEffect(() => {
    if (error) return;
    const timer = window.setTimeout(() => {
      const iframe = containerRef.current?.querySelector("iframe");
      if (!iframe) {
        logLifecycle("iframe_mount_timeout", { timeout_ms: MOUNT_TIMEOUT_MS, attempt });
        setError("The checkout form is taking too long to load. Please try again.");
      } else {
        logLifecycle("iframe_mounted", { attempt });
      }
    }, MOUNT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [attempt, error, logLifecycle]);

  const handleRetry = useCallback(() => {
    logLifecycle("retry_clicked", { attempt });
    setError(null);
    setSessionLoaded(false);
    setAttempt((n) => n + 1);
  }, [attempt, logLifecycle]);

  if (error) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
      >
        <div className="flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-medium">We couldn't load the checkout form.</p>
            <p className="mt-1 text-destructive/80">{error}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-background px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
        >
          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  }

  const showSkeleton = !countryReady || !sessionLoaded;
  const skeletonLabel = !countryReady
    ? "Preparing secure checkout…"
    : "Loading payment form…";

  return (
    <div className="relative min-h-[420px]">
      {showSkeleton && (
        <div
          role="status"
          aria-live="polite"
          aria-label={skeletonLabel}
          className="absolute inset-0 z-10 flex flex-col gap-4 rounded-md border border-border bg-background/95 p-6"
        >
          <Skeleton className="h-5 w-1/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-11 w-full" />
          <p className="mt-1 text-center text-xs text-muted-foreground">{skeletonLabel}</p>
        </div>
      )}
      <div id="checkout" ref={containerRef} key={attempt}>
        <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
          <EmbeddedCheckout />
        </EmbeddedCheckoutProvider>
      </div>
    </div>
  );
}


