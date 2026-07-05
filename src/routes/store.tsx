import { createFileRoute, Link } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import { listStoreItems } from "@/lib/store.functions";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";

const storeQuery = queryOptions({
  queryKey: ["store-items"],
  queryFn: () => listStoreItems(),
});

export const Route = createFileRoute("/store")({
  loader: ({ context }) => context.queryClient.ensureQueryData(storeQuery),
  head: () => ({
    meta: [
      { title: "Store — Princess Pink" },
      {
        name: "description",
        content: "Buy photo sets, videos, and bundles — or subscribe for all-access to Princess Pink's library.",
      },
      { property: "og:title", content: "Princess Pink · Store" },
      { property: "og:description", content: "Photo sets, videos, bundles, and an all-access pass." },
    ],
  }),
  component: StorePage,
  errorComponent: ({ error }) => (
    <div className="p-10 text-center text-sm text-muted-foreground">
      Something went wrong loading the store. {error.message}
    </div>
  ),
  notFoundComponent: () => <div className="p-10 text-center">Not found.</div>,
});

function StorePage() {
  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-6xl px-5 pt-10 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-primary">Boutique</div>
            <h1 className="mt-2 font-display text-4xl font-extrabold">
              Buy my <span className="text-neon">pictures &amp; videos</span>
            </h1>
            <p className="mt-3 max-w-xl text-sm text-muted-foreground">
              Individual sets and clips, or unlock everything with the All-Access Pass.
            </p>
          </div>
          <AllAccessCard />
        </div>

        <div className="mt-10">
          <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
            <ItemGrid />
          </Suspense>
        </div>
      </section>
    </>
  );
}

function AllAccessCard() {
  return (
    <div className="flex flex-col gap-3">
      <Link
        to="/store/subscribe"
        className="group rounded-2xl border border-primary/50 bg-primary/10 p-5 shadow-[var(--shadow-glow-pink)] hover:brightness-110"
      >
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">All-Access Pass</div>
        <div className="mt-1 font-display text-2xl font-bold">$10<span className="text-sm text-muted-foreground">/mo</span></div>
        <div className="mt-1 text-xs text-muted-foreground">Everything in the library, streaming in-app.</div>
      </Link>
      <Link
        to="/store/private-room"
        className="group rounded-2xl border border-primary/50 bg-background/40 p-5 hover:border-primary hover:bg-primary/5"
      >
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Private Room</div>
        <div className="mt-1 font-display text-2xl font-bold">
          From A$150<span className="text-sm text-muted-foreground"> / 30 min</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">Book a 30-minute or 1-hour private session.</div>
      </Link>
    </div>
  );
}


function ItemGrid() {
  const { data } = useSuspenseQuery(storeQuery);
  if (!data.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-16 text-center">
        <p className="font-display text-lg">The shelves are empty tonight.</p>
        <p className="mt-2 text-sm text-muted-foreground">New drops coming soon.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((item) => (
        <Link
          key={item.id}
          to="/store/$id"
          params={{ id: item.id }}
          className="group overflow-hidden rounded-2xl border border-border/60 bg-card transition hover:border-primary/60"
        >
          <div className="relative aspect-[4/5] w-full overflow-hidden bg-secondary/30">
            {item.cover_url ? (
              <img
                src={item.cover_url}
                alt={item.title}
                loading="lazy"
                className="h-full w-full object-cover transition group-hover:scale-105"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-xs text-muted-foreground">No cover</div>
            )}
            <div className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/90 backdrop-blur">
              {labelForKind(item.kind)}
            </div>
            {item.subscribers_only && (
              <div className="absolute right-2 top-2 rounded-full border border-primary/60 bg-primary/20 px-2 py-0.5 text-[10px] uppercase tracking-widest text-primary backdrop-blur">
                Subs only
              </div>
            )}
          </div>
          <div className="p-4">
            <div className="truncate font-medium">{item.title}</div>
            <div className="mt-1 text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
              {item.description || "Tap for details."}
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="font-display text-lg text-neon">
                {item.subscribers_only && !item.price_cents ? "Members" : item.price_cents ? formatPrice(item.price_cents) : "—"}
              </div>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground group-hover:text-primary">
                View →
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}

function labelForKind(kind: string) {
  return kind === "photo_set" ? "Photos" : kind === "video" ? "Video" : "Bundle";
}
function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
