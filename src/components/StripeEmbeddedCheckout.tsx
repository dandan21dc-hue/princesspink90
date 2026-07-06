import { useEffect, useState } from "react";
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
  const [country, setCountry] = useState<string | undefined>(undefined);
  useEffect(() => { detectCountry().then(setCountry); }, []);

  const fetchClientSecret = async (): Promise<string> => {
    const result = await createStoreCheckoutSession({
      data: {
        priceId: props.priceId,
        contentItemId: props.contentItemId,
        userId: props.userId,
        customerEmail: props.customerEmail,
        returnUrl: props.returnUrl || window.location.href,
        environment: getStripeEnvironment(),
        bookingStartsAt: props.bookingStartsAt,
        customerCountry: country,
      },
    });
    if ("error" in result) throw new Error(result.error);
    if (!result.clientSecret) throw new Error("Stripe did not return a client secret");
    return result.clientSecret;
  };

  return (
    <div id="checkout">
      <EmbeddedCheckoutProvider stripe={getStripe()} options={{ fetchClientSecret }}>
        <EmbeddedCheckout />
      </EmbeddedCheckoutProvider>
    </div>
  );
}
