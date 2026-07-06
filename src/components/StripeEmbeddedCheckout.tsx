import { useCallback, useEffect, useMemo, useRef } from "react";
import { EmbeddedCheckoutProvider, EmbeddedCheckout } from "@stripe/react-stripe-js";
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
      fail("exception", (e as Error)?.message);
      throw e;
    }
    if ("error" in result) {
      fail("server_error", String(result.error));
      throw new Error(result.error);
    }
    if (!result.clientSecret) {
      fail("no_client_secret");
      throw new Error("Stripe did not return a client secret");
    }
    return result.clientSecret;
  }, []);

  const options = useMemo(() => ({ fetchClientSecret }), [fetchClientSecret]);
  const stripePromise = useMemo(() => getStripe(), []);

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}

