import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { getCheckoutSession } from "@/lib/store.functions";
import { getStripeEnvironment } from "@/lib/stripe";
import { cart as cartStore } from "@/lib/cart";
import { track } from "@/lib/track";

/**
 * Landing page for Stripe's `return_url`. Stripe substitutes
 * `{CHECKOUT_SESSION_ID}` in the URL server-side before redirecting the
 * browser here, so `session_id` should always be a real `cs_...` id — not
 * the literal template string.
 *
 * The route:
 *  1. Validates `session_id` (and optional `next` destination) in search.
 *  2. Fetches the session server-side via `getCheckoutSession` to confirm
 *     status/metadata before granting UI access.
 *  3. Routes the user to the appropriate destination based on what they
 *     bought (membership → /library, booking → /dashboard, or the caller's
 *     explicit `next=` override).
 */

const ALLOWED_NEXT: readonly string[] = [
  "/library",
  "/dashboard",
  "/store",
];

function normalizeNext(next: string | undefined, metadata: { booking?: string | null } | null) {
  if (next && ALLOWED_NEXT.includes(next)) return next;
  if (metadata?.booking === "private_room") return "/dashboard";
  return "/library";
}

export const Route = createFileRoute("/checkout/return")({
  validateSearch: (search: Record<string, unknown>) => ({
    session_id: typeof search.session_id === "string" ? search.session_id : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
  }),
  component: CheckoutReturn,
  head: () => ({
    meta: [
      { title: "Finalizing your purchase" },
      { name: "robots", content: "noindex" },
    ],
  }),
});

function CheckoutReturn() {
  const { session_id: sessionId, next } = Route.useSearch();
  const navigate = useNavigate();

  // Guard: `{CHECKOUT_SESSION_ID}` means Stripe never substituted the
  // template — the return_url shipped with the braces percent-encoded, or
  // was overridden somewhere. Treat as an error rather than calling the
  // API with a garbage id.
  const templateNotSubstituted =
    !sessionId || sessionId === "{CHECKOUT_SESSION_ID}" || sessionId.includes("%7B");

  const query = useQuery({
    queryKey: ["checkout-session", sessionId],
    enabled: !templateNotSubstituted,
    retry: 2,
    queryFn: async () => {
      const result = await getCheckoutSession({
        data: { sessionId: sessionId!, environment: getStripeEnvironment() },
      });
      if ("error" in result) throw new Error(result.error);
      return result;
    },
  });

  const session = query.data;
  const isComplete = session?.status === "complete";
  const destination = normalizeNext(next, session?.metadata ?? null);

  useEffect(() => {
    if (!isComplete) return;
    // Cart mode: successful payment → wipe the local cart so the shopping bag
    // in the header resets and the user isn't offered a re-purchase.
    if (session?.metadata?.cart_mode === "1") {
      cartStore.clear();
    }
    const t = setTimeout(() => {
      navigate({ to: destination });
    }, 1500);
    return () => clearTimeout(t);
  }, [isComplete, destination, navigate, session?.metadata?.cart_mode]);

  return (
    <section className="mx-auto max-w-md px-5 py-24 text-center">
      {templateNotSubstituted ? (
        <>
          <h1 className="text-2xl font-medium">Missing session</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            We couldn't identify your Stripe checkout session. If you completed
            payment, it will still be processed — please check your library in a
            minute.
          </p>
          <Link to="/library" className="mt-6 inline-block underline">
            Go to your library
          </Link>
        </>
      ) : query.isLoading ? (
        <>
          <h1 className="text-2xl font-medium">Finalizing…</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Confirming your payment with Stripe.
          </p>
        </>
      ) : query.isError ? (
        <>
          <h1 className="text-2xl font-medium">Something went wrong</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {(query.error as Error).message}
          </p>
          <Link to="/library" className="mt-6 inline-block underline">
            Go to your library
          </Link>
        </>
      ) : isComplete ? (
        <>
          <h1 className="text-2xl font-medium">Thank you! 🎉</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Payment confirmed. Redirecting you now…
          </p>
          <Link to={destination as "/library"} className="mt-6 inline-block underline">
            Continue
          </Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-medium">Payment pending</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Stripe is still processing this payment (status:{" "}
            {session?.status ?? "unknown"}). You'll get access as soon as it
            completes.
          </p>
          <Link to="/library" className="mt-6 inline-block underline">
            Go to your library
          </Link>
        </>
      )}
    </section>
  );
}
