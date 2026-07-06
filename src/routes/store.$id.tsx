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
  const busy = pending !== null;

  useEffect(() => {
    // When the embedded checkout is dismissed, clear the pending state so
    // the buttons come back to life without needing a page reload.
    if (!isOpen && pending && pending !== "cart") setPending(null);
  }, [isOpen, pending]);

  if (!item) return <div className="p-10 text-center">Not found.</div>;

  const canBuyOneTime = !!item.price_cents && !item.subscribers_only;

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
            <div className="overflow-hidden rounded-2xl border border-border/60 bg-secondary/20 aspect-[4/5]">
              {item.cover_url ? (
                <img src={item.cover_url} alt={item.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">No cover</div>
              )}
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
                {item.kind === "photo_set" ? "Photo set" : item.kind === "video" ? "Video" : "Bundle"}
              </div>
              <h1 className="mt-2 font-display text-3xl font-extrabold">{item.title}</h1>
              {item.description && (
                <p className="mt-4 whitespace-pre-line text-sm text-muted-foreground leading-relaxed">
                  {item.description}
                </p>
              )}

              <div className="mt-8 space-y-3">
                {canBuyOneTime && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <button
                      onClick={buyThis}
                      className="rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
                    >
                      Buy · ${(item.price_cents! / 100).toFixed(2)}
                    </button>
                    <button
                      onClick={() => {
                        cart.add({
                          kind: "content",
                          id: item!.id,
                          title: item!.title,
                          unit_amount_cents: item!.price_cents!,
                          currency: (item!.currency ?? "aud").toLowerCase(),
                          cover_url: item!.cover_url,
                        });
                        toast.success("Added to cart");
                      }}
                      className="rounded-md border border-primary/60 px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary hover:bg-primary/10"
                    >
                      Add to cart
                    </button>
                  </div>
                )}
                <button
                  onClick={subscribe}
                  className="w-full rounded-md border border-primary/40 bg-primary/10 px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
                >
                  {item.subscribers_only ? "Subscribe to unlock ($10/mo)" : "Or get All-Access ($10/mo)"}
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
