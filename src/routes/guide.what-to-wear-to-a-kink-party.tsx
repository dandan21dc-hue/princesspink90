import { createFileRoute, Link } from "@tanstack/react-router";

const CANONICAL = "https://princesspink90.com/guide/what-to-wear-to-a-kink-party";
const TITLE = "What to Wear to a Kink Party — First-Timer's Dress Code Guide";
const DESCRIPTION =
  "What to wear to a kink party, what happens on the night, and the etiquette rules first-timers miss. Glory hole nights, theatre takeovers, and private rooms explained. 18+ only.";

const FAQS: { q: string; a: string }[] = [
  {
    q: "What should I wear to a kink party as a beginner?",
    a: "Wear all black at minimum — a fitted top or bodysuit, black pants or skirt, and boots. That reads as 'trying' at almost every kink night. If the invite calls for fetish, latex, leather or lingerie, take it literally: a harness, corset, mesh top, PVC skirt, fishnets or a collar all count. Jeans, hoodies and sneakers get turned away at the door.",
  },
  {
    q: "What actually happens at a kink party?",
    a: "You arrive, ID and waiver are checked, you change into your outfit, and you spend the night socialising, watching scenes, and — if you want — playing. Nobody is required to do anything sexual. Most guests spend most of the night talking. Play areas are separate from social areas so you can dip in and out.",
  },
  {
    q: "What's the difference between a glory hole night and a theatre takeover?",
    a: "A glory hole night is anonymous, wall-based play — you queue, you play through a wall, you leave. Outfits skew practical: something you can move in, easy to adjust, boots you can stand in for a while. A theatre takeover is a full-venue adult event with scenes, performances, and mingling — dress code goes harder (latex, leather, corsetry, full fetishwear).",
  },
  {
    q: "Can I go to a kink party alone?",
    a: "Yes. Most first-timers arrive solo. Hosts and dungeon monitors are there specifically so you have someone to check in with. Say hi at the door, tell them it's your first night, and they'll point you at the friendliest corner of the room.",
  },
  {
    q: "Do I have to play at a kink party?",
    a: "No. Watching and socialising are the default. 'Not tonight' and 'just watching' are complete answers — nobody at a well-run party will pressure you.",
  },
  {
    q: "Can I take photos at a kink party?",
    a: "Almost never. Phones stay in bags. No photos, no video, no live-streaming. If you want a photo of yourself or a partner, ask a host first and never include anyone else in the frame.",
  },
  {
    q: "What should I bring to a kink party?",
    a: "A small bag with your outfit, a coverup for the walk home, deodorant, wet wipes, a water bottle, cash for cloakroom or tips, your ID, and a phone charger. Skip strong cologne — play spaces get warm.",
  },
];

export const Route = createFileRoute("/guide/what-to-wear-to-a-kink-party")({
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
            { "@type": "ListItem", position: 3, name: "What to wear to a kink party", item: CANONICAL },
          ],
        }),
      },
    ],
  }),
  component: KinkPartyGuidePage,
});

function KinkPartyGuidePage() {
  return (
    <article className="mx-auto max-w-3xl px-4 py-16 text-foreground">
      <p className="text-xs uppercase tracking-widest text-neon">Guide · 18+ only</p>
      <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">
        What to Wear to a Kink Party
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        A first-timer's guide to kink party dress codes, what actually happens on
        the night, and the etiquette rules that separate a good guest from a
        one-time guest. Written for people heading to a Midnight Glory event —
        glory hole nights, theatre takeovers, and private rooms.
      </p>

      <a
        href="/downloads/kink-party-dress-code-checklist.pdf"
        download
        className="mt-6 inline-flex items-center gap-3 rounded-lg border border-neon/50 bg-neon/10 px-5 py-3 text-sm font-semibold text-neon shadow-[var(--shadow-glow-pink)] hover:bg-neon/20 transition"
      >
        <span aria-hidden="true">⬇</span>
        Download the printable one-page checklist (PDF)
      </a>

      <nav aria-label="On this page" className="mt-8 rounded-lg border border-border bg-card/50 p-4 text-sm">
        <p className="mb-2 text-xs uppercase tracking-widest text-muted-foreground">On this page</p>
        <ul className="grid gap-1 sm:grid-cols-2">
          <li><a href="#dress-code-basics" className="hover:text-neon">Dress-code basics</a></li>
          <li><a href="#glory-hole-nights" className="hover:text-neon">What to wear · glory hole nights</a></li>
          <li><a href="#theatre-takeovers" className="hover:text-neon">What to wear · theatre takeovers</a></li>
          <li><a href="#private-rooms" className="hover:text-neon">What to wear · private rooms</a></li>
          <li><a href="#what-happens" className="hover:text-neon">What happens at a kink party</a></li>
          <li><a href="#etiquette" className="hover:text-neon">Etiquette rules</a></li>
          <li><a href="#faq" className="hover:text-neon">FAQ</a></li>
        </ul>
      </nav>

      <section id="dress-code-basics" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Dress-code basics</h2>
        <p>
          Kink party dress codes exist for two reasons: they keep sightseers out,
          and they set the tone for the room. Follow the invite literally. If it
          says "fetish, latex, leather, lingerie or full black", those are your
          options — not "smart casual".
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li><strong>Safe default:</strong> all black — fitted top or bodysuit, black bottoms, boots.</li>
          <li><strong>Level up:</strong> latex, leather harness, corset, mesh, PVC, fishnets, collar or cuffs.</li>
          <li><strong>Footwear:</strong> boots or closed-toe heels. Floors get slippery — no sandals.</li>
          <li><strong>Skip:</strong> jeans, hoodies, sneakers, logos, sports jerseys, cargo shorts, heavy cologne.</li>
          <li><strong>Bring a bag:</strong> outfit, coverup, wet wipes, water, phone charger, ID.</li>
        </ul>
      </section>

      <section id="glory-hole-nights" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">What to wear · glory hole nights</h2>
        <p>
          Glory hole nights are anonymous and practical. You'll be standing,
          queuing, and moving between rooms. Prioritise mobility over spectacle.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Fitted black basics or an anonymous mask if the theme allows one.</li>
          <li>Bottoms that are easy to adjust — nothing you have to unlace to move.</li>
          <li>Boots you can comfortably stand in for a couple of hours.</li>
          <li>Skip long trailing sleeves, capes, and anything that snags.</li>
        </ul>
      </section>

      <section id="theatre-takeovers" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">What to wear · theatre takeovers</h2>
        <p>
          Theatre takeovers are full-venue adult events. The dress code goes
          harder because you'll be photographed by no one — but seen by everyone.
          This is where the room actually rewards effort.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Full fetishwear: latex dresses, leather harnesses, corsets, PVC.</li>
          <li>Statement footwear — heels, thigh-highs, platform boots.</li>
          <li>Coordinated pairs and groups tend to get the best reception.</li>
          <li>Still bring a coverup for the walk in and out.</li>
        </ul>
      </section>

      <section id="private-rooms" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">What to wear · private rooms</h2>
        <p>
          Private room bookings are less about the crowd and more about you and
          your guests. Wear what you actually want to play in — comfort and
          removability matter more than spectacle. Robes and slippers for
          in-between moments are welcome.
        </p>
      </section>

      <section id="what-happens" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">What happens at a kink party</h2>
        <ol className="list-decimal space-y-2 pl-6">
          <li>ID check, waiver sign-in, and coat check on arrival.</li>
          <li>Change into your outfit in the designated area — never in the play space.</li>
          <li>Grab a drink (usually water — heavy drinks and heavy scenes don't mix).</li>
          <li>Socialise. Most of the night is talking; play is a smaller share than newcomers expect.</li>
          <li>Watch a scene if you're curious. Stand back, stay quiet, never interrupt.</li>
          <li>Play only if you want to. "Just watching" is a complete answer.</li>
          <li>Aftercare and clean-up — water, wipes, and equipment wiped down before you walk away.</li>
        </ol>
      </section>

      <section id="etiquette" className="mt-12 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Etiquette rules that matter</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Ask before you touch. "May I touch your shoulder?" is a full sentence.</li>
          <li>"No" and "not tonight" are complete answers — do not negotiate.</li>
          <li>Silence is not consent. Neither is an outfit.</li>
          <li>Never interrupt a scene. Don't walk between the players and their equipment.</li>
          <li>Phones stay in bags — no photos, no video, no live-streaming.</li>
          <li>Don't out anyone. Names inside the venue stay inside the venue.</li>
          <li>Find the host or dungeon monitor if something feels off.</li>
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
          Midnight Glory runs 18+ consent-first nights across glory holes, private
          rooms, and adult theatre takeovers. See what's on next.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/store"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            See upcoming events
          </Link>
          <Link
            to="/guide/etiquette"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm"
          >
            Full etiquette guide
          </Link>
          <Link
            to="/conduct"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm"
          >
            Code of conduct
          </Link>
        </div>
      </section>
    </article>
  );
}
