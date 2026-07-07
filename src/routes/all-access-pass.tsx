import { createFileRoute, Link } from "@tanstack/react-router";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { AllAccessCard } from "@/components/AllAccessCard";

export const Route = createFileRoute("/all-access-pass")({
  head: () => ({
    meta: [
      { title: "All-Access Pass — Princess Pink" },
      {
        name: "description",
        content:
          "Unlock everything Princess Pink — monthly, term, or lifetime plans. Full library access to photo sets, videos, and bundles.",
      },
      { property: "og:title", content: "All-Access Pass · Princess Pink" },
      {
        property: "og:description",
        content: "Choose monthly, 3/6/12-month, or lifetime access to the full library.",
      },
      { property: "og:url", content: "https://princesspink90.lovable.app/all-access-pass" },
    ],
    links: [{ rel: "canonical", href: "https://princesspink90.lovable.app/all-access-pass" }],
  }),
  component: AllAccessPassPage,
});

function AllAccessPassPage() {
  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-5xl px-5 pt-10 pb-16">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Membership</div>
        <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
          The <span className="text-neon">All-Access Pass</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          One pass, the whole library — every photo set, video, and bundle. Pick the
          rhythm that suits you: monthly, term, or lifetime.
        </p>

        <div className="mt-8">
          <AllAccessCard />
        </div>

        <div className="mt-10 text-xs text-muted-foreground">
          <Link to="/store" className="underline hover:text-primary">
            ← Back to store
          </Link>
        </div>
      </section>
    </>
  );
}
