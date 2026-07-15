import { createFileRoute, Link } from "@tanstack/react-router";

const CANONICAL = "https://princesspink90.com/guide/what-happens-at-a-kink-party";
const TITLE = "What Happens at a Kink Party — A First-Timer's Walkthrough";
const DESCRIPTION =
  "What actually happens at a kink party, minute by minute — arrival, ID and waiver, changing, socialising, scenes, play, aftercare and heading home. Written for first-timers. 18+ only.";

const FAQS: { q: string; a: string }[] = [
  {
    q: "What happens when you arrive at a kink party?",
    a: "You queue at the door, show ID, sign or confirm the waiver, and pay any door fee. A host checks your outfit against the dress code. You're pointed at the cloakroom and change rooms, then given a quick house-rules brief — consent, phones away, where the dungeon monitors are.",
  },
  {
    q: "How long does a kink party usually run?",
    a: "Most run four to six hours. Doors open, there's a slow social first hour, scenes ramp up mid-evening, and things wind down with aftercare and clean-up before the venue closes. Arrive in the first ninety minutes so you actually meet people before the room gets busy.",
  },
  {
    q: "Do you have to play at a kink party?",
    a: "No. Watching and socialising are the default. Plenty of guests spend the whole night in the lounge chatting. 'Just watching' and 'not tonight' are complete answers and no one at a well-run party will push back.",
  },
  {
    q: "What's a scene at a kink party?",
    a: "A scene is a pre-negotiated bit of play between consenting adults — impact, rope, wax, sensation, whatever the players agreed to. Onlookers stand back, stay quiet, don't cross the equipment, and never interrupt. If you want to watch closer, ask the players or a dungeon monitor first.",
  },
  {
    q: "Is there sex at a kink party?",
    a: "Depends on the event. Some Midnight Glory nights are play-only (impact, rope, sensation). Others — glory hole nights, private-room bookings, theatre takeovers — include sex in designated areas. The invite spells it out. Nothing is required of any guest.",
  },
  {
    q: "What's aftercare?",
    a: "The wind-down after a scene — water, a blanket, quiet talk, checking in on how each player is doing. It matters for the people who played and for anyone who watched something intense. Hosts keep water, snacks and a calm corner available for it.",
  },
  {
    q: "Can I leave whenever I want?",
    a: "Yes. There's no lock-in. Grab your bag from the cloakroom and walk out. Hosts will offer to walk solo guests to a rideshare if you ask.",
  },
];

export const Route = createFileRoute("/guide/what-happens-at-a-kink-party")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: CANONICAL },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESCRIPTION },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Article",
          headline: TITLE,
          description: DESCRIPTION,
          author: { "@type": "Organization", name: "Midnight Glory" },
          publisher: { "@type": "Organization", name: "Midnight Glory" },
          mainEntityOfPage: CANONICAL,
          inLanguage: "en-AU",
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: FAQS.map((f) => ({
            "@type": "Question",
            name: f.q,
            acceptedAnswer: { "@type": "Answer", text: f.a },
          })),
        }),
      },
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Home", item: "https://princesspink90.com/" },
            { "@type": "ListItem", position: 2, name: "Guides", item: "https://princesspink90.com/guide/etiquette" },
            { "@type": "ListItem", position: 3, name: "What happens at a kink party", item: CANONICAL },
          ],
        }),
      },
    ],
  }),
  component: WhatHappensPage,
});

function WhatHappensPage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 text-foreground">
      <p className="text-xs uppercase tracking-widest text-neon">Guide · 18+ only</p>
      <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">
        What Happens at a Kink Party
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        A minute-by-minute walkthrough for first-timers — what the door looks
        like, how a scene runs, when to play, when to just watch, and how the
        night winds down. Written for people heading to their first Midnight
        Glory event.
      </p>

      <nav aria-label="On this page" className="mt-8 rounded-lg border border-border bg-card/50 p-4 text-sm">
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">On this page</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          <li><a href="#arrival" className="hover:text-neon">Arrival &amp; door</a></li>
          <li><a href="#first-hour" className="hover:text-neon">The first hour</a></li>
          <li><a href="#scenes" className="hover:text-neon">Watching a scene</a></li>
          <li><a href="#playing" className="hover:text-neon">If you want to play</a></li>
          <li><a href="#aftercare" className="hover:text-neon">Aftercare &amp; wind-down</a></li>
          <li><a href="#leaving" className="hover:text-neon">Leaving safely</a></li>
          <li><a href="#faq" className="hover:text-neon">FAQ</a></li>
        </ul>
      </nav>

      <section id="arrival" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Arrival &amp; the door</h2>
        <p>
          Doors open at a set time — usually 8 or 9pm. Arrive in the first
          ninety minutes; showing up right at midnight means walking into a room
          that's already deep into scenes.
        </p>
        <ol className="list-decimal space-y-2 pl-6">
          <li>Queue at the door. Have ID out — 18+ is checked on every guest, every time.</li>
          <li>Waiver: sign or confirm the digital waiver you completed at booking.</li>
          <li>Dress-code check. If you're borderline, hosts will suggest a fix.</li>
          <li>Cloakroom for coats, bags, and street clothes.</li>
          <li>Change into your outfit in the designated area — never in the play space.</li>
          <li>Short house-rules brief: consent, phones away, where the dungeon monitors are.</li>
        </ol>
      </section>

      <section id="first-hour" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">The first hour is social</h2>
        <p>
          The room is quiet at first on purpose. People arrive, get changed,
          grab water, and stand around meeting each other. This is when to
          introduce yourself to the host and say it's your first night — they
          will point you at the friendliest corner of the room.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Grab water. Heavy drinks and heavy scenes don't mix — most regulars stay mostly sober.</li>
          <li>Walk the venue once: social area, play area, bathrooms, cloakroom, exits.</li>
          <li>Say hi. "First time — anything I should know?" is a great opener.</li>
          <li>Notice the dungeon monitors — the staff in a visible armband or sash. Any of them will help you at any point.</li>
        </ul>
      </section>

      <section id="scenes" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Watching a scene</h2>
        <p>
          A scene is a pre-negotiated bit of play between consenting adults —
          impact, rope, wax, sensation. Watching is welcome; being a bad
          audience is not.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Stand back. There's an unspoken perimeter around the equipment — don't cross it.</li>
          <li>Stay quiet. No commentary, no cheering, no advice.</li>
          <li>Never touch the players or their gear. Don't walk between them and the equipment.</li>
          <li>Phones stay in bags. No photos, no video, no live-streaming — ever.</li>
          <li>If a scene makes you uncomfortable, quietly step out. That's the correct move.</li>
        </ul>
      </section>

      <section id="playing" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">If you want to play</h2>
        <p>
          You don't have to. Most first-timers watch and socialise their whole
          first night. If you do want to play, it's always negotiated
          beforehand — never inferred from an outfit, a look, or a vibe.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Ask, plainly. "Would you like to play?" or "Can I ask you about a scene?"</li>
          <li>Negotiate: what you'd both like, what's off-limits, safewords, and how you'll check in.</li>
          <li>Book a piece of equipment through the host if the play area is busy.</li>
          <li>"No" and "not tonight" are complete answers — do not push back and do not negotiate around them.</li>
          <li>Check in mid-scene. A quiet "colour?" ("green / yellow / red") is standard.</li>
        </ul>
      </section>

      <section id="aftercare" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Aftercare &amp; wind-down</h2>
        <p>
          Aftercare is the wind-down after a scene — water, a blanket, quiet
          talk, checking in on how each player is doing. Hosts keep a calm
          corner, water, and snacks available for it. If you watched a scene
          that hit you harder than expected, aftercare applies to you too —
          find the calm corner, get water, and talk to a host.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Water and something to eat. Blood sugar drops after adrenaline.</li>
          <li>Wipe down equipment before you walk away from it — cleaning supplies are provided.</li>
          <li>Check in with your partner or the person you played with the next day.</li>
        </ul>
      </section>

      <section id="leaving" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Leaving safely</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Get changed back before you head out — coverup on, boots off if you brought flats.</li>
          <li>Grab everything from the cloakroom. Phones stay off until you're outside.</li>
          <li>Rideshares are the safest way home. Hosts will walk solo guests out if you ask.</li>
          <li>Names inside the venue stay inside the venue. Don't out anyone in a group chat the next morning.</li>
        </ul>
      </section>

      <section id="faq" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Frequently asked questions</h2>
        <div className="divide-y divide-border rounded-lg border border-border">
          {FAQS.map((f) => (
            <details key={f.q} className="group p-4 open:bg-card/50">
              <summary className="cursor-pointer list-none font-semibold marker:hidden">
                <span className="mr-2 text-neon">Q.</span>
                {f.q}
              </summary>
              <p className="mt-3 text-muted-foreground">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="mt-12 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-xl font-semibold">Ready for a first night?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Midnight Glory runs 18+ consent-first nights across glory holes,
          private rooms, and adult theatre takeovers. See what's on next.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/store"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            See upcoming events
          </Link>
          <Link
            to="/guide/what-to-wear-to-a-kink-party"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm"
          >
            What to wear
          </Link>
          <Link
            to="/guide/etiquette"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm"
          >
            Full etiquette guide
          </Link>
        </div>
      </section>
    </article>
  );
}
