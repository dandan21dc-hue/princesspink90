import { createFileRoute, Link } from "@tanstack/react-router";
import { useSuspenseQuery, queryOptions } from "@tanstack/react-query";
import { Suspense } from "react";
import { listPublicEvents } from "@/lib/events.functions";
import { getSiteSettings } from "@/lib/settings.functions";
import { EventCard } from "@/components/EventCard";
import heroImg from "@/assets/hero.jpg";

const eventsQuery = queryOptions({
  queryKey: ["public-events"],
  queryFn: () => listPublicEvents(),
});

const settingsQuery = queryOptions({
  queryKey: ["site-settings"],
  queryFn: () => getSiteSettings(),
});

export const Route = createFileRoute("/")({
  loader: ({ context }) =>
    Promise.all([
      context.queryClient.ensureQueryData(eventsQuery),
      context.queryClient.ensureQueryData(settingsQuery),
    ]),
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
      <section className="mx-auto max-w-6xl px-5 pb-16">
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
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <Link
          to="/store"
          className="group flex items-center justify-between gap-4 rounded-3xl border border-primary/40 bg-gradient-to-r from-primary/20 via-primary/5 to-transparent p-6 shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition"
        >
          <div>
            <div className="text-[10px] uppercase tracking-[0.3em] text-primary">New · Boutique</div>
            <div className="mt-1 font-display text-2xl font-bold sm:text-3xl">
              Buy my pictures &amp; videos
            </div>
            <div className="mt-1 text-sm text-muted-foreground">
              Individual sets and clips — or unlock everything with the $10/mo All-Access Pass.
            </div>
          </div>
          <span className="shrink-0 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground">
            Enter →
          </span>
        </Link>
      </section>
      <HostBlock />
      <CohostBlock />
    </>
  );
}

function CohostBlock() {
  const perks = [
    "Co-produce nights with me",
    "Vetted, consent-first guests",
    "Split the door + tips",
    "Full backend + check-in tools",
  ];
  return (
    <section id="cohost" className="mx-auto max-w-6xl px-5 pb-24">
      <div className="rounded-3xl border border-neon/30 bg-gradient-to-br from-neon/10 via-background to-background p-8 sm:p-12 shadow-[var(--shadow-glow-pink)]">
        <div className="text-xs uppercase tracking-[0.3em] text-neon">Co-host program · Women only</div>
        <h2 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
          Host <span className="text-neon">with me</span>
        </h2>
        <p className="mt-5 max-w-2xl text-muted-foreground leading-relaxed">
          I'm opening co-host slots to verified women who want to run events on this
          platform — whether you already throw parties or you're ready to start.
          Verified 18+ only; applications reviewed personally.
        </p>
        <ul className="mt-6 flex flex-wrap gap-2">
          {perks.map((p) => (
            <li
              key={p}
              className="rounded-full border border-neon/40 bg-neon/10 px-3 py-1 text-xs uppercase tracking-widest text-neon"
            >
              {p}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/cohost-apply"
            className="rounded-md bg-neon px-6 py-3 text-sm font-semibold uppercase tracking-widest text-background shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition"
          >
            Apply to co-host →
          </Link>
          <Link
            to="/verify"
            className="rounded-md border border-neon/40 bg-neon/10 px-6 py-3 text-sm font-semibold uppercase tracking-widest text-neon hover:bg-neon/20 transition"
          >
            Verify 18+ first
          </Link>
        </div>
      </div>
    </section>
  );
}



function HostBlock() {
  const { data: settings } = useSuspenseQuery(settingsQuery);
  const tags = [
    "Glory hole nights",
    "Gang bangs",
    "Adult theatre takeovers",
    "Custom scenes",
  ];
  return (
    <section id="host" className="mx-auto max-w-6xl px-5 pb-24">
      <div className="rounded-3xl border border-primary/30 bg-gradient-to-br from-primary/10 via-background to-background p-8 sm:p-12 shadow-[var(--shadow-glow-pink)]">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Your host</div>
        <h2 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
          Princess <span className="text-neon">Pink</span>
        </h2>
        <p className="mt-5 max-w-2xl text-muted-foreground leading-relaxed">
          I curate discreet, consent-first nights at adult theatres and private
          venues — from anonymous booth play to hand-picked group scenes. Every
          guest is vetted. Every room is safe, filthy, and unforgettable.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {tags.map((t) => (
            <span
              key={t}
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs uppercase tracking-widest text-primary"
            >
              {t}
            </span>
          ))}
        </div>
        <div className="mt-8 grid gap-3 sm:grid-cols-3">
          <ContactCard label="Email" value={settings.email} href={`mailto:${settings.email}`} />
          <ContactCard label="FetLife" value={`/${settings.fetlife_handle}`} href={`https://fetlife.com/${settings.fetlife_handle}`} />
          <ContactCard label="Reddit" value={`u/${settings.reddit_handle}`} href={`https://reddit.com/u/${settings.reddit_handle}`} />
        </div>
      </div>
    </section>
  );
}

function ContactCard({ label, value, href }: { label: string; value: string; href: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group rounded-2xl border border-border/60 bg-card/40 p-4 backdrop-blur hover:border-primary/50 hover:bg-card/60 transition"
    >
      <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">{label}</div>
      <div className="mt-1 font-display text-lg text-foreground group-hover:text-neon transition">{value}</div>
    </a>
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
            Hosted by Princess Pink · 18+
          </div>
          <h1 className="mt-6 font-display text-5xl font-extrabold leading-[1.05] sm:text-7xl">
            Glory holes, gang bangs,{" "}
            <span className="text-neon animate-neon">and the theatre after dark.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-muted-foreground leading-relaxed">
            Princess Pink curates discreet, consent-first nights at adult
            theatres and private venues. Browse the public marquee, or enter a
            code to unlock a private invitation.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="#events"
              className="rounded-md bg-primary px-6 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition"
            >
              See the marquee
            </a>
            <a
              href="#host"
              className="rounded-md border border-border bg-background/40 px-6 py-3 text-sm font-semibold uppercase tracking-widest backdrop-blur hover:bg-secondary/40 transition"
            >
              Meet the host
            </a>
          </div>
        </div>
      </div>
      <div id="events" />
    </section>
  );
}
