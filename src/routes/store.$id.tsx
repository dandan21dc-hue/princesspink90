import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getStoreItem } from "@/lib/store.functions";
import { supabase } from "@/integrations/supabase/client";
import { useStripeCheckout } from "@/hooks/useStripeCheckout";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { cart } from "@/lib/cart";

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
        { title: `${loaderData.title} — Princess Pink store` },
        { name: "description", content: loaderData.description ?? "Buy on Princess Pink's store." },
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
            offers: loaderData.price_cents
              ? {
                  "@type": "Offer",
                  price: (loaderData.price_cents / 100).toFixed(2),
                  priceCurrency: "USD",
                  availability: "https://schema.org/InStock",
                  url,
                }
              : undefined,
          }),
        },
      ],
    };
  },
  component: ItemPage,
  errorComponent: ({ error }) => (
    <div className="p-10 text-center text-sm text-muted-foreground">{error.message}</div>
  ),
  notFoundComponent: () => <div className="p-10 text-center">Item not found.</div>,
});

function ItemPage() {
  const { id } = Route.useParams();
  const { data: item } = useSuspenseQuery(itemQuery(id));
  const navigate = useNavigate();
  const [user, setUser] = useState<{ id: string; email?: string } | null>(null);
  const { openCheckout, checkoutElement, isOpen, closeCheckout } = useStripeCheckout();
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
  const gallery: string[] = Array.isArray((item as any).media_urls) && (item as any).media_urls.length
    ? ((item as any).media_urls as string[])
    : item.cover_url
      ? [item.cover_url]
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
    setPending("subscribe");
    openCheckout({
      priceId: "all_access_monthly_aud",
      userId: user.id,
      customerEmail: user.email,
      returnUrl: `${window.location.origin}/checkout/return?next=%2Flibrary`,
    });
  }

  return (
    <>
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
                  <img src={gallery[activeImage]} alt={item.title} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No image</div>
                )}
              </div>
              {gallery.length > 1 && (
                <div className="mt-3 grid grid-cols-5 gap-2">
                  {gallery.map((src, i) => (
                    <button
                      key={src + i}
                      onClick={() => setActiveImage(i)}
                      aria-label={`Show image ${i + 1}`}
                      className={`overflow-hidden rounded-md border aspect-square ${i === activeImage ? "border-primary" : "border-border/60 opacity-70 hover:opacity-100"}`}
                    >
                      <img src={src} alt="" className="h-full w-full object-cover" />
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
