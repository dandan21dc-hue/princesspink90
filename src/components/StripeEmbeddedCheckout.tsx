import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
import { AlertCircle, RefreshCw } from "lucide-react";
import { getStripe, getStripeEnvironment } from "@/lib/stripe";
import { createStoreCheckoutSession } from "@/lib/store.functions";
import { track } from "@/lib/track";

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
  // Keep country in a ref so async detection does NOT trigger a re-render.
  // Re-rendering hands EmbeddedCheckoutProvider a new `options.fetchClientSecret`,
  // which Stripe rejects ("You cannot change fetchClientSecret after setting it"),
  // and the checkout form never mounts.
  const countryRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    detectCountry().then((c) => {
      countryRef.current = c;
    });
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
  const containerRef = useRef<HTMLDivElement | null>(null);

  const fetchClientSecret = useCallback(async (): Promise<string> => {
    const p = propsRef.current;
    const source = p.priceId ?? p.contentItemId ?? "unknown";
    const kind = p.priceId?.startsWith("panty_")
      ? "panty"
      : p.priceId
        ? "subscription"
        : p.contentItemId
          ? "content_item"
          : p.bookingStartsAt
            ? "private_room"
            : "unknown";
    const fail = (reason: string, message?: string) => {
      track("stripe_checkout_session_failed", {
        kind,
        source,
        environment: getStripeEnvironment(),
        reason,
        ...(message && { message: message.slice(0, 200) }),
      });
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
    return result.clientSecret;
    // attempt is intentionally in deps so each retry creates a fresh fetcher.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Fail loudly if Stripe.js itself doesn't load (blocked, offline, bad key).
  const stripePromise = useMemo(() => {
    const p = getStripe();
    p.then((s) => {
      if (!s) setError("Stripe failed to load. Check your connection or ad blockers and try again.");
    }).catch((e) => {
      setError((e as Error)?.message ?? "Stripe failed to load.");
    });
    return p;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  const options = useMemo(() => ({ fetchClientSecret }), [fetchClientSecret]);

  // Watchdog: if no iframe appears in the checkout container within the timeout,
  // treat it as a mount failure so the user isn't stuck on a blank spinner.
  useEffect(() => {
    if (error) return;
    const timer = window.setTimeout(() => {
      const iframe = containerRef.current?.querySelector("iframe");
      if (!iframe) {
        setError("The checkout form is taking too long to load. Please try again.");
      }
    }, MOUNT_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [attempt, error]);

  const handleRetry = useCallback(() => {
    setError(null);
    setAttempt((n) => n + 1);
  }, []);

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

  return (
    <div id="checkout" ref={containerRef} key={attempt}>
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
