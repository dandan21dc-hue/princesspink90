import { createFileRoute, Link } from "@tanstack/react-router";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { track } from "@/lib/track";

export const Route = createFileRoute("/panty-drawer")({
  head: () => ({
    meta: [
      { title: "The Panty Drawer — Princess Pink" },
      {
        name: "description",
        content:
          "Worn, sealed, shipped discreetly across Australia. Choose 24, 48, or 72 hours worn — signed and packaged with care.",
      },
      { property: "og:title", content: "The Panty Drawer · Princess Pink" },
      {
        property: "og:description",
        content: "24, 48, and 72-hour worn pairs. Sealed pouch, discreet Australia-wide shipping.",
      },
      { property: "og:url", content: "https://princesspink90.lovable.app/panty-drawer" },
    ],
    links: [{ rel: "canonical", href: "https://princesspink90.lovable.app/panty-drawer" }],
  }),
  component: PantyDrawerPage,
});

function PantyDrawerPage() {
  const tiers: Array<{
    label: string;
    price: string;
    perks: string[];
    highlight?: string;
  }> = [
    {
      label: "24 Hours Worn",
      price: "A$60",
      perks: ["Worn 24 hours", "Sealed pouch", "Signed thank-you note"],
    },
    {
      label: "48 Hours Worn",
      price: "A$90",
      perks: ["Worn 48 hours", "Sealed pouch", "Signed thank-you note"],
    },
    {
      label: "72 Hours Worn",
      price: "A$120",
      perks: [
        "Worn 72 hours",
        "Sealed pouch",
        "Handwritten note + free photo of the pair worn",
      ],
      highlight: "Popular",
    },
  ];

  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-5xl px-5 pt-10 pb-16">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">The Panty Drawer</div>
        <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
          For your <span className="text-neon">extra kinky side</span> 💋
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Worn, sealed, and shipped discreetly across Australia. Shipping
          (A$15) is added at checkout. Subscriber discounts apply automatically at
          the counter.
        </p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiers.map((t) => (
            <div
              key={t.label}
              className="relative rounded-2xl border border-primary/40 bg-primary/5 p-5 shadow-[var(--shadow-glow-pink)]"
            >
              {t.highlight && (
                <span className="absolute -top-2 right-4 rounded-full bg-gold-gradient px-2 py-0.5 text-[9px] font-extrabold uppercase tracking-widest text-black shadow-lg">
                  ★ {t.highlight}
                </span>
              )}
              <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
                {t.label}
              </div>
              <div className="mt-2 font-display text-3xl font-extrabold">
                {t.price}
                <span className="ml-1 text-xs font-normal text-muted-foreground">
                  + shipping
                </span>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {t.perks.map((perk) => (
                  <li key={perk}>· {perk}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-3">
          <Link
            to="/store/subscribe"
            hash="panty-buy-cards"
            onClick={() => track("panty_link_click", { location: "panty_drawer_page" })}
            className="rounded-md bg-primary px-5 py-3 text-xs font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110"
          >
            Shop the drawer
          </Link>
          <Link
            to="/store"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Back to store
          </Link>
        </div>
      </section>
    </>
  );
}
