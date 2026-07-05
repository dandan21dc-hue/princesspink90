import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Suspense } from "react";
import { listPublicEvents } from "@/lib/events.functions";
import { EventCard } from "@/components/EventCard";
import heroImg from "@/assets/hero.jpg";

const eventsQuery = queryOptions({
  queryKey: ["public-events"],
  queryFn: () => listPublicEvents(),
});

export const Route = createFileRoute("/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(eventsQuery),
  head: () => ({
    meta: [
      { property: "og:image", content: "https://id-preview--2ea7609b-c928-4ad6-b438-a4db3aadd458.lovable.app/og.jpg" },
    ],
  }),
  component: Home,
});

function Home() {
  return (
    <>
      <Hero />
      <section className="mx-auto max-w-6xl px-5 pb-24">
        <div className="mb-8 flex items-end justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-primary">Upcoming</div>
            <h2 className="mt-2 font-display text-3xl font-semibold">Nights on the marquee</h2>
          </div>
          <Link
            to="/unlock"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Have a code? →
          </Link>
        </div>
        <Suspense fallback={<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{Array.from({length: 3}).map((_,i)=><div key={i} className="aspect-[4/5] rounded-2xl bg-card animate-pulse"/>)}</div>}>
          <EventList />
        </Suspense>
      </section>
    </>
  );
}

function EventList() {
  const { data } = useSuspenseQuery(eventsQuery);
  if (!data.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-16 text-center">
        <p className="font-display text-lg">The marquee is dark tonight.</p>
        <p className="mt-2 text-sm text-muted-foreground">Check back soon — or ask your host for a code.</p>
      </div>
    );
  }
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {data.map((e) => <EventCard key={e.id} event={e} />)}
    </div>
  );
}

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <img
        src={heroImg}
        alt=""
        fetchPriority="high"
        className="absolute inset-0 h-full w-full object-cover opacity-60"
      />
      <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
      <div className="relative mx-auto max-w-6xl px-5 pt-20 pb-28 sm:pt-32 sm:pb-40">
        <div className="max-w-2xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.25em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-neon" />
            Members-only · 18+
          </div>
          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.05] sm:text-7xl">
            After the credits roll,{" "}
            <span className="text-neon animate-neon">the real show begins.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground leading-relaxed">
            AFTERDARK curates discreet, consent-first nights at adult theatres
            and grown-up venues. Browse the public marquee, or enter a code to
            unlock a private invitation.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#events"
              className="rounded-md bg-primary px-6 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition"
            >
              See the marquee
            </a>
            <Link
              to="/unlock"
              className="rounded-md border border-border bg-background/40 px-6 py-3 text-sm font-semibold uppercase tracking-widest backdrop-blur hover:bg-secondary/40 transition"
            >
              Enter a code
            </Link>
          </div>
        </div>
      </div>
      <div id="events" />
    </section>
  );
}
