import { createFileRoute, Link, Outlet, useMatches, useNavigate } from "@tanstack/react-router";
import { queryOptions, useSuspenseQuery } from "@tanstack/react-query";
import { Suspense, useMemo, useState } from "react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { listStoreItems } from "@/lib/store.functions";
import { track } from "@/lib/track";
import allAccessCover from "@/assets/store-all-access.jpg?w=480;768;1024&format=avif;webp;jpg&as=picture";
import privateRoomCover from "@/assets/store-private-room.jpg?w=480;768;1024&format=avif;webp;jpg&as=picture";
import pantyDrawerCover from "@/assets/store-panty-drawer.jpg?w=480;768;1024&format=avif;webp;jpg&as=picture";
type PictureImport = {
  sources: Record<string, string>;
  img: { src: string; w: number; h: number };
};
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { cn } from "@/lib/utils";
import { X, SlidersHorizontal } from "lucide-react";


export const storeQuery = queryOptions({
  queryKey: ["store-items"],
  queryFn: () => listStoreItems(),
});

const storeSearchSchema = z.object({
  sizes: fallback(z.array(z.string()), []).default([]),
  colors: fallback(z.array(z.string()), []).default([]),
  styles: fallback(z.array(z.string()), []).default([]),
});

export const Route = createFileRoute("/store")({
  validateSearch: zodValidator(storeSearchSchema),
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
      { property: "og:url", content: "https://princesspink90.lovable.app/store" },
    ],
    links: [{ rel: "canonical", href: "https://princesspink90.lovable.app/store" }],
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

  // /store is both a leaf page AND a layout parent for /store/subscribe,
  // /store/$id. When a child route matches, render only the child so the
  // boutique landing content doesn't leak into every child.
  const matches = useMatches();
  const isChild = matches.some((m) => m.routeId !== "__root__" && m.routeId !== "/store" && m.routeId.startsWith("/store"));
  if (isChild) return <Outlet />;

  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-6xl px-5 pt-10 pb-10">
        <div className="max-w-2xl">
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Boutique</div>
          <h1 className="mt-2 font-display text-4xl font-extrabold">
            Buy my <span className="text-neon">pictures &amp; videos</span>
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Individual sets and clips below, or jump into one of the three main
            experiences.
          </p>
        </div>

        <CategoryCards />
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Shop the library</div>
            <h2 className="mt-1 font-display text-2xl font-bold">Individual sets &amp; clips</h2>
          </div>
        </div>
        <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
          <FilteredItemGrid />
        </Suspense>
      </section>
    </>
  );
}

/**
 * Three top-level entry points on the boutique landing: All-Access Pass,
 * Private Room, and The Panty Drawer. Each links to its own dedicated
 * page where the full purchase / booking flow lives.
 */
function CategoryCards() {
  const cards: Array<{
    to: "/all-access-pass" | "/private-room" | "/panty-drawer";
    eyebrow: string;
    title: string;
    price: string;
    priceSuffix: string;
    blurb: string;
    image: PictureImport;
    imageAlt: string;
    cta: string;
  }> = [
    {
      to: "/all-access-pass",
      eyebrow: "Membership",
      title: "All-Access Pass",
      price: "From A$10",
      priceSuffix: "/ month",
      blurb: "Unlock every set, every video, every bundle in the library.",
      image: allAccessCover,
      imageAlt: "Neon-lit boutique with pink glow behind velvet drapes",
      cta: "Choose a plan",
    },
    {
      to: "/private-room",
      eyebrow: "1-on-1",
      title: "Private Room",
      price: "From A$150",
      priceSuffix: "/ 30 min",
      blurb: "Book a 30-minute or 1-hour private session with me.",
      image: privateRoomCover,
      imageAlt: "Moody private lounge lit with soft pink light behind sheer curtains",
      cta: "Book a session",
    },
    {
      to: "/panty-drawer",
      eyebrow: "Discreet",
      title: "The Panty Drawer",
      price: "From A$60",
      priceSuffix: "/ pair",
      blurb: "Worn, sealed, shipped discreetly across Australia.",
      image: pantyDrawerCover,
      imageAlt: "Close-up of pink lace lingerie with a black-ribboned gift box in shadow",
      cta: "Open the drawer",
    },
  ];

  return (
    <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((c, idx) => (
        <Link
          key={c.to}
          to={c.to}
          onClick={() =>
            track("store_category_card_click", {
              destination: c.to,
              category: c.title,
              position: idx + 1,
            })
          }
          aria-label={`${c.title} — ${c.cta}`}
          className="group relative flex flex-col overflow-hidden rounded-3xl border border-border bg-card/60 transition-all duration-300 hover:border-primary/60 hover:shadow-[0_0_40px_-10px_hsl(var(--primary)/0.45)] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
            <picture>
              {Object.entries(c.image.sources).map(([format, srcset]) => (
                <source key={format} type={`image/${format}`} srcSet={srcset} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" />
              ))}
              <img
                src={c.image.img.src}
                alt={c.imageAlt}
                width={c.image.img.w}
                height={c.image.img.h}
                loading={idx === 0 ? "eager" : "lazy"}
                fetchPriority={idx === 0 ? "high" : "auto"}
                decoding="async"
                sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
                className="h-full w-full object-cover grayscale transition-all duration-700 ease-out group-hover:scale-110 group-hover:grayscale-0 group-focus-visible:scale-110 group-focus-visible:grayscale-0"
              />
            </picture>
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent"
            />
          </div>
          <div className="relative flex flex-1 flex-col p-6 sm:p-8">
            <div className="text-[10px] font-black uppercase tracking-[0.25em] text-primary">
              {c.eyebrow}
            </div>
            <div className="mt-3 font-display text-2xl font-extrabold text-foreground">
              {c.title}
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="font-display text-lg font-bold text-foreground">
                {c.price}
              </span>
              <span className="text-xs font-normal text-muted-foreground">
                {c.priceSuffix}
              </span>
            </div>
            <p className="mt-3 flex-grow text-sm leading-relaxed text-muted-foreground">
              {c.blurb}
            </p>
            <div className="mt-8 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-bold uppercase tracking-widest text-primary-foreground transition-all group-hover:bg-primary/90 group-active:scale-[0.98]">
              {c.cta} →
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}




type StoreItem = Awaited<ReturnType<typeof listStoreItems>>[number];

function tokenize(input: string | null | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[,/&|]|\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function FilteredItemGrid() {
  const { data } = useSuspenseQuery(storeQuery);
  const { sizes, colors, styles } = Route.useSearch();
  const navigate = useNavigate({ from: "/store" });
  const [mobileOpen, setMobileOpen] = useState(false);

  const { sizeOptions, colorOptions, styleOptions } = useMemo(() => {
    const sSet = new Set<string>();
    const cSet = new Set<string>();
    const stSet = new Set<string>();
    for (const it of data as StoreItem[]) {
      ((it.sizes ?? []) as string[]).forEach((s: string) => s && sSet.add(s));
      tokenize(it.materials as string | null).forEach((c: string) => cSet.add(c));
      if (it.kind) stSet.add(it.kind);
    }
    const sortStr = (a: string, b: string) => a.localeCompare(b);
    return {
      sizeOptions: [...sSet].sort(sortStr),
      colorOptions: [...cSet].sort(sortStr),
      styleOptions: [...stSet].sort(sortStr),
    };
  }, [data]);

  const filtered = useMemo(() => {
    return (data as StoreItem[]).filter((item) => {
      if (styles.length && !styles.includes(item.kind)) return false;
      if (sizes.length) {
        const itemSizes = (item.sizes ?? []) as string[];
        if (!sizes.some((s: string) => itemSizes.includes(s))) return false;
      }
      if (colors.length) {
        const tokens = tokenize(item.materials as string | null).map((t) => t.toLowerCase());
        if (!colors.some((c: string) => tokens.includes(c.toLowerCase()))) return false;
      }
      return true;
    });
  }, [data, sizes, colors, styles]);

  const toggle = (group: "sizes" | "colors" | "styles", value: string) => {
    navigate({
      search: (prev: z.infer<typeof storeSearchSchema>) => {
        const current = (prev[group] ?? []) as string[];
        const next = current.includes(value)
          ? current.filter((v) => v !== value)
          : [...current, value];
        return { ...prev, [group]: next };
      },
    });
  };

  const clearAll = () => navigate({ search: { sizes: [], colors: [], styles: [] } });

  const activeCount = sizes.length + colors.length + styles.length;

  if (!data.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-16 text-center">
        <p className="font-display text-lg">The shelves are empty tonight.</p>
        <p className="mt-2 text-sm text-muted-foreground">New drops coming soon.</p>
      </div>
    );
  }

  const sidebar = (
    <aside className="w-full md:w-64 md:shrink-0 rounded-2xl border border-border/60 bg-card/60 p-5 md:sticky md:top-24 md:self-start">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Filters</div>
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[11px] text-muted-foreground hover:text-primary"
          >
            Clear all
          </button>
        )}
      </div>

      <FilterGroup
        label="Style"
        options={styleOptions}
        selected={styles}
        onToggle={(v) => toggle("styles", v)}
        renderLabel={labelForKind}
      />
      <FilterGroup
        label="Size"
        options={sizeOptions}
        selected={sizes}
        onToggle={(v) => toggle("sizes", v)}
      />
      <FilterGroup
        label="Color / Material"
        options={colorOptions}
        selected={colors}
        onToggle={(v) => toggle("colors", v)}
      />
    </aside>
  );

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <div className="hidden md:block">{sidebar}</div>

      <div className="flex-1 min-w-0">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            Showing {filtered.length} of {data.length}
            {activeCount > 0 ? ` · ${activeCount} filter${activeCount === 1 ? "" : "s"} active` : ""}
          </div>
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-card px-3 py-1.5 text-xs md:hidden"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Filters{activeCount > 0 ? ` (${activeCount})` : ""}
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
            <p className="font-display text-lg">No matches.</p>
            <p className="mt-2 text-sm text-muted-foreground">Try clearing some filters.</p>
            <button
              type="button"
              onClick={clearAll}
              className="mt-4 rounded-full border border-primary/60 px-4 py-1.5 text-xs uppercase tracking-widest text-primary hover:bg-primary/10"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => (
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
                      decoding="async"
                      sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
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
        )}
      </div>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <div className="absolute right-0 top-0 h-full w-[85%] max-w-sm overflow-y-auto bg-background p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="font-display text-lg">Filters</div>
              <button
                type="button"
                onClick={() => setMobileOpen(false)}
                aria-label="Close filters"
                className="rounded-full p-2 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4">{sidebar}</div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  options,
  selected,
  onToggle,
  renderLabel,
}: {
  label: string;
  options: string[];
  selected: string[];
  onToggle: (value: string) => void;
  renderLabel?: (value: string) => string;
}) {
  if (options.length === 0) return null;
  return (
    <div className="mt-5">
      <div className="text-xs font-medium text-foreground/90">{label}</div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              aria-pressed={active}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[11px] transition",
                active
                  ? "border-primary bg-primary/20 text-primary"
                  : "border-border/60 bg-background/40 text-muted-foreground hover:border-primary/60 hover:text-foreground",
              )}
            >
              {renderLabel ? renderLabel(opt) : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}


function labelForKind(kind: string) {
  return kind === "photo_set" ? "Photos" : kind === "video" ? "Video" : "Bundle";
}
function formatPrice(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}
