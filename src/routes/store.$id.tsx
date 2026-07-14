import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStoreItem } from "@/lib/store.functions";

import { useStripeCheckout, useSubscriptionComingSoon } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { cart } from "@/lib/cart";
import { buildAudOffer } from "@/lib/aud";
import { onImgError, resolveMediaUrl } from "@/lib/media-url";

const itemQuery = (id: string) =>
  queryOptions({
    queryKey: ["store-item", id],
    queryFn: () => getStoreItem({ data: { id } }),
  });

export const Route = createFileRoute("/store/$id")({
  loader: ({ context, params }) => context.queryClient.ensureQueryData(itemQuery(params.id)),
  head: ({ params, loaderData }) => {
    const url = `https://princesspink90.lovable.app/store/${params.id}`;
    if (!loaderData) {
      return {
        meta: [
          { title: "Store item" },
          { property: "og:url", content: url },
        ],
        links: [{ rel: "canonical", href: url }],
      };
    }
    return {
      meta: [
        { title: `${loaderData.title} — Midnight Glory store` },
        { name: "description", content: loaderData.description ?? "Buy on Midnight Glory's store." },
        { property: "og:title", content: loaderData.title },
        { property: "og:description", content: loaderData.description ?? "" },
        { property: "og:type", content: "product" },
        { property: "og:url", content: url },
        ...(loaderData.cover_url ? [{ property: "og:image", content: loaderData.cover_url }] : []),
      ],
      links: [{ rel: "canonical", href: url }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Product",
            name: loaderData.title,
            description: loaderData.description ?? undefined,
            image: loaderData.cover_url ?? undefined,
            url,
            offers: buildAudOffer({
              cents: loaderData.price_cents,
              url,
              availability: "https://schema.org/InStock",
              currency: (loaderData as { currency?: string | null }).currency ?? null,
            }) ?? undefined,
          }),
        },
      ],
    };
  },
  component: ItemPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
  notFoundComponent: PageNotFound,
});

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-4xl px-5 pt-8 pb-16">
        <Link to="/store" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Store
        </Link>
        {children}
      </section>
    </>
  );
}

function PagePending() {
  return (
    <PageShell>
      <div className="mt-6 grid gap-8 md:grid-cols-2" role="status" aria-busy="true" aria-live="polite">
        <div className="aspect-[4/5] animate-pulse rounded-2xl bg-muted/30" />
        <div className="space-y-4">
          <div className="h-4 w-24 animate-pulse rounded bg-muted/40" />
          <div className="h-8 w-3/4 animate-pulse rounded bg-muted/40" />
          <div className="h-6 w-32 animate-pulse rounded bg-muted/40" />
          <div className="h-24 animate-pulse rounded bg-muted/30" />
        </div>
        <span className="sr-only">Loading item…</span>
      </div>
    </PageShell>
  );
}

function PageError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <PageShell>
      <div role="alert" className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-6">
        <div className="text-xs uppercase tracking-[0.3em] text-destructive">
          Couldn't load this item
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message ?? "Something went wrong loading this item."}
        </p>
        <button
          type="button"
          onClick={() => reset()}
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
      <p className="mt-8 text-sm text-muted-foreground">This item could not be found.</p>
    </PageShell>
  );
}

function ItemPage() {
  const { id } = Route.useParams();
  const { data: item } = useSuspenseQuery(itemQuery(id));
  const navigate = useNavigate();
  const [user] = useState<{ id: string; email?: string } | null>(null);
  const { openCheckout, checkoutElement, isOpen, closeCheckout } = useStripeCheckout();
  const subComingSoon = useSubscriptionComingSoon();
  const [pending, setPending] = useState<null | "buy" | "subscribe" | "cart">(null);
  const [activeImage, setActiveImage] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const busy = pending !== null;

  useEffect(() => {
    // When the embedded checkout is dismissed, clear the pending state so
    // the buttons come back to life without needing a page reload.
    if (!isOpen && pending && pending !== "cart") setPending(null);
  }, [isOpen, pending]);

  const sizes: string[] = Array.isArray((item as any)?.sizes) ? ((item as any).sizes as string[]) : [];
  useEffect(() => {
    if (selectedSize === null && sizes.length) setSelectedSize(sizes[0]);
  }, [sizes, selectedSize]);

  if (!item) return <div className="p-10 text-center">Not found.</div>;

  const canBuyOneTime = !!item.price_cents && !item.subscribers_only;
  const rawMedia = (item as { media_urls?: unknown }).media_urls;
  const gallery: Array<{ url: string; type: "image" | "video" }> = Array.isArray(rawMedia) && rawMedia.length
    ? (rawMedia as Array<{ url: string; type: "image" | "video" }>)
    : item.cover_url
      ? [{ url: item.cover_url, type: "image" }]
      : [];
  const materials: string | null = (item as any).materials ?? null;



  function buyThis() {
    if (busy) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    setPending("buy");
    openCheckout({
      contentItemId: item!.id,
      userId: user.id,
      customerEmail: user.email,
      returnUrl: `${window.location.origin}/checkout/return?next=%2Flibrary`,
    });
  }
  function subscribe() {
    if (busy) return;
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    subComingSoon.show();
  }

  return (
    <>
      {subComingSoon.element}
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-4xl px-5 pt-8 pb-16">
        <Link to="/store" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          ← Store
        </Link>

        {isOpen ? (
          <div className="mt-6 rounded-2xl border border-border/60 bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="font-display text-lg">Checkout</div>
              <button onClick={closeCheckout} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
                Cancel
              </button>
            </div>
            {checkoutElement}
          </div>
        ) : (
          <div className="mt-6 grid gap-8 md:grid-cols-2">
            <div>
              <div className="overflow-hidden rounded-2xl border border-border/60 bg-secondary/20 aspect-[4/5]">
                {gallery[activeImage] ? (
                  gallery[activeImage].type === "video" ? (
                    <video
                      src={gallery[activeImage].url}
                      className="h-full w-full object-cover"
                      controls
                      playsInline
                      preload="metadata"
                    />
                  ) : (
                    <img src={resolveMediaUrl(gallery[activeImage].url) ?? ""} alt={item.title} onError={onImgError} className="h-full w-full object-cover" />
                  )
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image</div>
                )}
              </div>
              {gallery.length > 1 && (
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {gallery.map((m, i) => (
                    <button
                      key={m.url + i}
                      onClick={() => setActiveImage(i)}
                      aria-label={`Show ${m.type} ${i + 1}`}
                      className={`overflow-hidden rounded-md border aspect-square ${i === activeImage ? "border-primary" : "border-border/60 opacity-70 hover:opacity-100"}`}
                    >
                      {m.type === "video" ? (
                        <video src={m.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      ) : (
                        <img src={resolveMediaUrl(m.url) ?? ""} alt="" onError={onImgError} className="h-full w-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
                {item.kind === "photo_set" ? "Photo set" : item.kind === "video" ? "Video" : "Bundle"}
              </div>
              <h1 className="mt-2 font-display text-3xl font-extrabold">{item.title}</h1>
              {item.price_cents ? (
                <div className="mt-2 font-display text-2xl text-neon">
                  ${(item.price_cents / 100).toFixed(2)} <span className="text-xs uppercase tracking-widest text-muted-foreground">{(item.currency ?? "aud").toUpperCase()}</span>
                </div>
              ) : null}
              {item.description && (
                <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              )}

              {sizes.length > 0 && (
                <div className="mt-6">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Size</div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {sizes.map((s) => (
                      <button
                        key={s}
                        onClick={() => setSelectedSize(s)}
                        className={`min-w-11 rounded-md border px-3 py-2 text-sm font-medium transition ${selectedSize === s ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:text-foreground"}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {materials && (
                <div className="mt-6">
                  <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Materials</div>
                  <p className="mt-1 text-sm text-foreground/90">{materials}</p>
                </div>
              )}


              <div className="mt-8 space-y-3">
                {canBuyOneTime && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={buyThis}
                      disabled={busy}
                      className="min-h-11 rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {pending === "buy"
                        ? "Processing…"
                        : `Buy · $${(item.price_cents! / 100).toFixed(2)}`}
                    </button>
                    <button
                      onClick={() => {
                        if (busy) return;
                        setPending("cart");
                        try {
                          cart.add({
                            kind: "content",
                            id: item!.id,
                            title: item!.title,
                            unit_amount_cents: item!.price_cents!,
                            currency: (item!.currency ?? "aud").toLowerCase(),
                            cover_url: item!.cover_url,
                            ...(selectedSize ? { size: selectedSize } : {}),
                          });
                          toast.success("Added to cart");
                        } finally {
                          // Debounce briefly so the button visibly toggles and
                          // absorbs an accidental double-click.
                          setTimeout(() => setPending(null), 600);
                        }
                      }}
                      disabled={busy}
                      className="min-h-11 rounded-md border border-primary/60 px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-70"
                    >
                      {pending === "cart" ? "Adding…" : "Add to cart"}
                    </button>
                  </div>
                )}
                <button
                  onClick={subscribe}
                  disabled={busy}
                  className="min-h-11 w-full rounded-md border border-primary/40 bg-primary/10 px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-70"
                >
                  {pending === "subscribe"
                    ? "Processing…"
                    : item.subscribers_only
                      ? "Subscribe to unlock ($10/mo)"
                      : "Or get All-Access ($10/mo)"}
                </button>
                <p className="text-[11px] text-muted-foreground text-center">
                  After payment you'll unlock it in <Link to="/library" className="underline">your library</Link>.
                </p>
              </div>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
