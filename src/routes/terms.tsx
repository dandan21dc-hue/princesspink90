import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Terms of Service · PRINCESS PINK" },
      {
        name: "description",
        content:
          "Terms of Service governing use of PRINCESS PINK — the members-only adult content library, ticketed events, and private-room sessions.",
      },
      { property: "og:title", content: "Terms of Service · PRINCESS PINK" },
      {
        property: "og:description",
        content:
          "Terms of Service governing use of PRINCESS PINK — members-only adult content, ticketed events, and private-room sessions.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Terms,
});

function Terms() {
  return (
    <section className="mx-auto max-w-3xl px-5 py-14 text-sm leading-relaxed text-muted-foreground">
      <div className="text-xs uppercase tracking-[0.3em] text-primary">Legal</div>
      <h1 className="mt-2 font-display text-4xl font-extrabold text-foreground">
        Terms of Service
      </h1>
      <p className="mt-2 text-xs">Last updated: 2026-07-06</p>

      <div className="mt-8 space-y-6">
        <p>
          By creating an account, purchasing content, subscribing to a pass, or
          booking any session with PRINCESS PINK (the "Service"), you agree to
          these Terms of Service and to our{" "}
          <Link to="/privacy" className="text-primary underline">Privacy Policy</Link>{" "}
          and{" "}
          <Link to="/conduct" className="text-primary underline">Standards of Conduct</Link>.
        </p>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">1. Eligibility (18+)</h2>
          <p className="mt-2">
            You must be 18 years of age or older (or the age of majority where you live,
            if higher) and accessing this content must be legal in your jurisdiction. We
            reserve the right to request official identification to verify your age
            status at any time.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">2. Accounts</h2>
          <p className="mt-2">
            You are responsible for keeping your login credentials secure and
            for all activity on your account. Do not share access to
            members-only content.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">3. Payments &amp; renewals</h2>
          <p className="mt-2">
            Monthly plans renew automatically until cancelled. 3-, 6-, and
            12-month term passes are single upfront lump-sum payments and do
            not auto-renew. The Lifetime membership is a single one-time
            payment. All charges are in the currency shown at checkout and are
            processed by Stripe.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">4. Refunds</h2>
          <p className="mt-2">
            Digital content, memberships, and event tickets are non-refundable
            once access is granted, except where required by law. Contact
            support if you believe you were charged in error.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">5. Content licence</h2>
          <p className="mt-2">
            All photos, videos, and other media are the property of the
            creator. Your membership grants a personal, non-transferable,
            non-exclusive licence to stream and view them while your access is
            active. You may not download, screen-record, republish, or
            redistribute any content.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">6. Events &amp; private sessions</h2>
          <p className="mt-2">
            Attendance at ticketed events and private-room bookings is subject
            to consent, safety, and conduct rules set out in our{" "}
            <Link to="/conduct" className="text-primary underline">Standards of Conduct</Link>.
            Breaching them may result in cancellation without refund and a
            permanent ban.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">7. Termination</h2>
          <p className="mt-2">
            We may suspend or terminate access at any time for breach of these
            terms, illegal activity, or conduct that puts other members or
            performers at risk.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">8. Changes</h2>
          <p className="mt-2">
            We may update these terms from time to time. Continued use of the
            Service after changes take effect constitutes acceptance of the
            revised terms.
          </p>
        </section>

        <section>
          <h2 className="font-display text-lg font-semibold text-foreground">9. Contact</h2>
          <p className="mt-2">
            Questions? Reach us through the{" "}
            <Link to="/support" className="text-primary underline">support chat</Link>{" "}
            once signed in.
          </p>
        </section>
      </div>
    </section>
  );
}
