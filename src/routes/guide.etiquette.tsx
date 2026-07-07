import { createFileRoute, Link } from "@tanstack/react-router";

const CANONICAL = "https://princesspink90.lovable.app/guide/etiquette";
const TITLE = "BDSM Party Dress Code & Etiquette Guide for First-Timers";
const DESCRIPTION =
  "What to wear and how to behave at your first BDSM party. Practical outfit ideas, consent rules, and etiquette from Princess Pink. 18+ only.";

const FAQS: { q: string; a: string }[] = [
  {
    q: "What should I wear to my first BDSM party?",
    a: "Follow the invite's dress code literally. Safe defaults are all black — a fitted top or bodysuit, black pants or skirt, and boots. Level up with leather, latex, corsets, mesh, fishnets, harnesses or a collar. Avoid street clothes, logos, sports jerseys, cargo shorts and open sandals.",
  },
  {
    q: "Can I wear jeans and sneakers to a BDSM party?",
    a: "No. Jeans, hoodies, sneakers and work shirts are the fastest way to be turned away at the door. The dress code protects the vibe and keeps sightseers out — dress the code or wear all black.",
  },
  {
    q: "How does consent work at a BDSM party?",
    a: "Consent is explicit, enthusiastic and reversible. You ask before you touch, ask before you watch closely, and never take photos. 'No' and 'not tonight' are complete answers. Silence is not consent, and neither is an outfit.",
  },
  {
    q: "Can I take photos at a BDSM party?",
    a: "Almost never. Most venues ban cameras entirely. Phones stay in bags — no photos, no video, no live-streaming. If you want a photo of yourself or a partner, ask a host whether it is allowed and never include anyone else in the frame.",
  },
  {
    q: "Is it okay to watch a scene as a first-timer?",
    a: "Yes, watching is welcome, but stand back, stay quiet and never interrupt. Do not walk between the players and their scene, do not comment, and do not touch equipment that is in use.",
  },
  {
    q: "Should I drink alcohol at a BDSM party?",
    a: "Keep it minimal or skip it. Alcohol and heavy scenes do not mix — impaired consent is not consent. Drink water, eat before you arrive, and leave when you are done, not when you are wasted.",
  },
];

export const Route = createFileRoute("/guide/etiquette")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESCRIPTION },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESCRIPTION },
      { property: "og:type", content: "article" },
      { property: "og:url", content: CANONICAL },
      { name: "twitter:card", content: "summary_large_image" },
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
          author: { "@type": "Organization", name: "Princess Pink" },
          publisher: { "@type": "Organization", name: "Princess Pink" },
          mainEntityOfPage: CANONICAL,
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
    ],
  }),
  component: EtiquettePage,
});

function EtiquettePage() {
  return (
    <main className="mx-auto max-w-3xl px-4 py-16 text-foreground">
      <p className="text-xs uppercase tracking-widest text-neon">Guide · 18+ only</p>
      <h1 className="mt-2 font-display text-4xl font-bold sm:text-5xl">
        BDSM Party Dress Code & Etiquette Guide
      </h1>
      <p className="mt-4 text-lg text-muted-foreground">
        Your first BDSM party is exciting, a little nerve-wracking, and totally survivable.
        Here is what to wear, how to behave, and how consent actually works on the floor —
        written for real first-timers heading to a Princess Pink night.
      </p>

      <section className="mt-10 space-y-4">
        <h2 className="font-display text-2xl font-semibold">What to wear</h2>
        <p>
          Most BDSM parties have a dress code. It is not gatekeeping — it protects the vibe
          and keeps sightseers out. If the invite says "fetish, latex, leather, lingerie or
          full black", take it literally. Street clothes (jeans, hoodies, sneakers, work
          shirts) are the fastest way to get turned around at the door.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Safe defaults:</strong> all black — a fitted tee or bodysuit, black
            pants or a skirt, and boots. You will blend in at almost any play party.
          </li>
          <li>
            <strong>Level up:</strong> leather harness, latex top, corset, mesh, sheer
            layers, PVC skirt, fishnets, collar, cuffs.
          </li>
          <li>
            <strong>Footwear:</strong> boots or closed-toe heels. Open sandals and flip-flops
            are usually a no — floors get slippery.
          </li>
          <li>
            <strong>Bring a bag:</strong> deodorant, wet wipes, a bottle of water, a phone
            charger, and a coverup for the walk home.
          </li>
          <li>
            <strong>Skip:</strong> logos, sports jerseys, cargo shorts, strong cologne, and
            anything you would wear to brunch.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Consent on the floor</h2>
        <p>
          Consent at a BDSM party is explicit, enthusiastic, and reversible. You ask before
          you touch. You ask before you watch closely. You ask before you take a photo (usually
          the answer is no — most venues ban cameras entirely).
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>Ask, don't assume — "May I touch your shoulder?" is a full sentence.</li>
          <li>"No" and "not tonight" are complete answers. Do not negotiate.</li>
          <li>Silence is not consent. Neither is an outfit.</li>
          <li>Do not interrupt a scene. If you want to watch, stand back and stay quiet.</li>
          <li>Aftercare matters — bring water and check in with your partner afterward.</li>
        </ul>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="font-display text-2xl font-semibold">House rules most parties share</h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>Phones stay in bags. No photos, no video, no live-streaming.</li>
          <li>Do not out anyone. Names inside the venue stay inside the venue.</li>
          <li>Drink water. Alcohol and heavy scenes do not mix.</li>
          <li>Find the dungeon monitor or host if something feels off.</li>
          <li>Clean up after yourself — wipe down equipment before you walk away.</li>
        </ul>
      </section>

      <section className="mt-10 space-y-4">
        <h2 className="font-display text-2xl font-semibold">Your first night, in one line</h2>
        <p>
          Dress the code, drink water, ask before you touch, respect a no, and leave when
          you're done — not when you're wasted.
        </p>
      </section>

      <section className="mt-10 space-y-4">
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



      <section className="mt-10 rounded-lg border border-border bg-card p-6">
        <h2 className="font-display text-xl font-semibold">Ready for a first party?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Princess Pink runs 18+ consent-first nights — glory holes, private rooms, and
          adult theatre takeovers. Check what's on and grab a ticket.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/store"
            className="inline-flex items-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            See upcoming events
          </Link>
          <Link
            to="/conduct"
            className="inline-flex items-center rounded-md border border-border px-4 py-2 text-sm"
          >
            Read our code of conduct
          </Link>
        </div>
      </section>
    </main>
  );
}
