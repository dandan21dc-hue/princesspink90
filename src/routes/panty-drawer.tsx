import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { listPantyListingsPublic, type PantyListing } from "@/lib/pantyListings.functions";
import { track } from "@/lib/track";
import { onImgError, resolveMediaUrl } from "@/lib/media-url";

export const Route = createFileRoute("/panty-drawer")({
  head: () => ({
    meta: [
      { title: "The Panty Drawer — Midnight Glory" },
      {
        name: "description",
        content:
          "Individually listed pairs from the drawer. Sealed pouch, discreet Australia-wide shipping.",
      },
      { property: "og:title", content: "The Panty Drawer · Midnight Glory" },
      {
        property: "og:description",
        content: "Hand-picked pairs — each with its own photo and price. Discreet AU shipping.",
      },
      { property: "og:url", content: "https://princesspink90.lovable.app/panty-drawer" },
    ],
    links: [{ rel: "canonical", href: "https://princesspink90.lovable.app/panty-drawer" }],
  }),
  component: PantyDrawerPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
  notFoundComponent: PageNotFound,
});

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-6xl px-5 pt-10 pb-16">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">The Panty Drawer</div>
        <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
          For your <span className="text-neon">extra kinky side</span> 💋
        </h1>
        {children}
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            to="/store"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Back to store
          </Link>
        </div>
      </section>
    </>
  );
}

function PagePending() {
  return (
    <PageShell>
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true" aria-live="polite">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-muted/30" />
        ))}
        <span className="sr-only">Loading listings…</span>
      </div>
    </PageShell>
  );
}

function PageError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <PageShell>
      <div role="alert" className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-6">
        <div className="text-xs uppercase tracking-[0.3em] text-destructive">
          Couldn't load the drawer
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message ?? "Something went wrong while loading listings."}
        </p>
        <button
          type="button"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </PageShell>
  );
}

function PageNotFound() {
  return (
    <PageShell>
      <p className="mt-8 text-sm text-muted-foreground">This page could not be found.</p>
    </PageShell>
  );
}

function formatAud(cents: number | null): string {
  if (cents == null) return "—";
  const v = cents / 100;
  return `A$${v.toFixed(v % 1 === 0 ? 0 : 2)}`;
}

function PantyDrawerPage() {
  const [user, setUser] = useState<{ id: string; email?: string } | null | undefined>(undefined);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { openCheckout, checkoutElement, isOpen, closeCheckout } = useStripeCheckout();

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      const u = data.user;
      setUser(u ? { id: u.id, email: u.email ?? undefined } : null);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email ?? undefined } : null);
    });
    return () => {
      sub.subscription.unsubscribe();
    };
  }, []);

  const q = useQuery({
    queryKey: ["panty-listings-public"],
    queryFn: () => listPantyListingsPublic(),
    staleTime: 60_000,
  });

  const listings = q.data ?? [];

  const handleBuy = (listing: PantyListing) => {
    if (!user) {
      toast.error("Please sign in to purchase.");
      return;
    }
    setPendingId(listing.id);
    track("panty_listing_buy_click", { listing_id: listing.id, price_cents: listing.price_cents ?? 0 });
    openCheckout({
      pantyListingId: listing.id,
      userId: user.id,
      customerEmail: user.email,
      returnUrl: `${window.location.origin}/checkout/return?session_id={CHECKOUT_SESSION_ID}`,
    });
  };

  useEffect(() => {
    if (!isOpen) setPendingId(null);
  }, [isOpen]);

  return (
    <>
      <PageShell>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Each pair is one-of-one — photographed, sealed, and shipped discreetly across Australia.
          A$15 shipping added at checkout. Subscriber discount applies automatically.
        </p>

        {q.isLoading ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" role="status" aria-busy="true" aria-live="polite">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-muted/30" />
            ))}
            <span className="sr-only">Loading listings…</span>
          </div>
        ) : q.isError ? (
          <div
            role="alert"
            className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-6"
          >
            <div className="text-xs uppercase tracking-[0.3em] text-destructive">
              Couldn't load the drawer
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {q.error instanceof Error
                ? q.error.message
                : "Something went wrong while loading listings."}
            </p>
            <button
              type="button"
              onClick={() => void q.refetch()}
              disabled={q.isFetching}
              className="mt-4 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {q.isFetching ? "Retrying…" : "Try again"}
            </button>
          </div>
        ) : listings.length === 0 ? (
          <div className="mt-10 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-10 text-center">
            <div className="text-xs uppercase tracking-[0.3em] text-primary">Drawer refresh</div>
            <p className="mt-3 font-display text-2xl font-bold">
              New items coming soon — check back shortly.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Fresh pairs are added regularly.
            </p>
          </div>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {listings.map((l) => (
              <article
                key={l.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-primary/30 bg-card/50 shadow-[var(--shadow-glow-pink)] transition hover:border-primary"
              >
                <div className="relative aspect-[3/4] w-full overflow-hidden bg-muted/20">
                  {l.cover_url ? (
                    <img
                      src={resolveMediaUrl(l.cover_url) ?? ""}
                      alt={l.title}
                      loading="lazy"
                      onError={onImgError}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                    />
                  ) : (
                    <div className="grid h-full place-items-center text-xs text-muted-foreground">
                      No photo yet
                    </div>
                  )}
                </div>
                <div className="flex flex-1 flex-col gap-3 p-4">
                  <div>
                    <h2 className="font-display text-lg font-bold leading-tight">{l.title}</h2>
                    {[l.color, l.style, l.size].filter(Boolean).length > 0 && (
                      <div className="mt-1 text-[11px] uppercase tracking-widest text-muted-foreground">
                        {[l.color, l.style, l.size].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {l.description && l.description.trim().length > 0 && (
                      <p
                        className="mt-2 text-sm text-muted-foreground/90 whitespace-pre-line line-clamp-3 transition-[max-height,opacity] group-hover:line-clamp-none"
                        title={l.description}
                      >
                        {l.description}
                      </p>
                    )}
                  </div>
                  <div className="mt-auto flex items-end justify-between gap-3">
                    <div className="font-display text-2xl font-extrabold">
                      {formatAud(l.price_cents)}
                      <span className="ml-1 text-[10px] font-normal text-muted-foreground">
                        + shipping
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleBuy(l)}
                      disabled={pendingId === l.id || !l.price_cents}
                      className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {pendingId === l.id ? "Opening…" : "Buy"}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        <p className="mt-6 text-[11px] text-muted-foreground">
          18+ only. Australia-only shipping. All sales final; discreet plain packaging.
        </p>
      </PageShell>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4"
          onClick={closeCheckout}
        >
          <div
            className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-lg border border-border bg-background"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <div className="text-xs uppercase tracking-widest text-primary">Checkout</div>
              <button
                type="button"
                onClick={closeCheckout}
                className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
            <div className="p-2">{checkoutElement}</div>
          </div>
        </div>
      )}
    </>
  );
}
