import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/conduct")({
  head: () => ({
    meta: [
      { title: "Our Standards — Consent, Safety & Community Conduct" },
      {
        name: "description",
        content:
          "Our Consent-First philosophy, zero-tolerance harassment policy, and how our vetting process keeps the community safe.",
      },
      { property: "og:title", content: "Our Standards" },
      {
        property: "og:description",
        content:
          "How we define consent, why we have zero tolerance for harassment, and how vetting protects the community.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ConductPage,
});

const LAST_UPDATED = "5 July 2026";

function Section({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="border-t border-border/50 py-10 sm:py-12">
      <div className="mx-auto max-w-3xl px-5">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">
          {eyebrow}
        </div>
        <h2 className="mt-3 font-display text-2xl font-semibold sm:text-3xl">
          {title}
        </h2>
        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
          {children}
        </div>
      </div>
    </section>
  );
}

function ConductPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-3xl px-5 pt-16 pb-8 sm:pt-20 sm:pb-10">
        <Link
          to="/"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
        <div className="mt-8 text-xs uppercase tracking-[0.3em] text-primary">
          Community
        </div>
        <h1 className="mt-3 font-display text-3xl font-semibold sm:text-5xl">
          Our Standards
        </h1>
        <p className="mt-3 text-xs uppercase tracking-widest text-muted-foreground">
          Last updated: {LAST_UPDATED}
        </p>
        <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">
          Everything we build is in service of one idea: adults should be able
          to gather in spaces where enthusiastic consent is the baseline,
          personal safety is protected, and everyone present has been through
          the same standards of vetting. These are the commitments we hold
          ourselves — and every member — to.
        </p>
      </header>

      <Section eyebrow="Principle 01" title="Consent-First, always">
        <p>
          Consent is the foundation of every interaction on this platform and
          at every event we host. It is not a checkbox at the door — it is an
          ongoing, enthusiastic, and revocable agreement between adults.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-foreground">Enthusiastic.</span> Anything
            less than a clear "yes" is a "no". Silence, hesitation, or
            ambiguity means stop and ask.
          </li>
          <li>
            <span className="text-foreground">Ongoing.</span> Consent to one
            thing, at one moment, with one person, is not consent to anything
            else. It can be withdrawn at any time, for any reason, without
            explanation.
          </li>
          <li>
            <span className="text-foreground">Informed.</span> Everyone
            involved should understand what is being agreed to. Impairment,
            coercion, or power imbalance invalidates consent.
          </li>
          <li>
            <span className="text-foreground">Respected.</span> "No", "stop",
            "not tonight", or a safeword ends the interaction immediately — no
            negotiation, no guilt-tripping, no follow-up pressure.
          </li>
        </ul>
      </Section>

      <Section
        eyebrow="Principle 02"
        title="Zero tolerance for harassment"
      >
        <p>
          Harassment of any member — attendee, host, cohost, performer, or
          staff — is grounds for immediate removal from the platform and any
          associated event, without refund and without appeal for serious
          incidents.
        </p>
        <p>
          We treat the following as harassment, whether it happens on-platform,
          in DMs, at an event, or in any related space:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            Unwanted physical contact, following someone, or ignoring a "no".
          </li>
          <li>
            Sexual, racist, transphobic, homophobic, ableist, or otherwise
            discriminatory language or behaviour.
          </li>
          <li>
            Recording, photographing, or sharing images of any member without
            their explicit, in-the-moment consent.
          </li>
          <li>
            Threats, intimidation, doxxing, or attempts to out someone's
            identity, orientation, or attendance.
          </li>
          <li>
            Retaliation against anyone who raises a safety concern or reports
            an incident.
          </li>
        </ul>
        <p>
          Reports go to our safety team and are investigated confidentially.
          Bans are recorded and enforced across every future event.
        </p>
      </Section>

      <Section eyebrow="Principle 03" title="How vetting protects the community">
        <p>
          Access to events is not open by default. Every member goes through
          the same layered vetting process before they can RSVP or attend, and
          hosts have the same obligations as guests.
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-foreground">Age verification.</span> Every
            account must provide proof of age (18+) reviewed by a human before
            any event access is granted.
          </li>
          <li>
            <span className="text-foreground">Identity checks.</span> Members
            confirm they are who they say they are. Duplicate, fake, or
            recycled accounts are removed.
          </li>
          <li>
            <span className="text-foreground">Health screening, where required.</span>{" "}
            For events that require it, recent STI/STD screening documents are
            reviewed by an admin and stored under strict privacy controls. See
            our <Link to="/privacy" className="text-primary hover:underline">
              Privacy Policy
            </Link>{" "}
            for how sensitive information is handled.
          </li>
          <li>
            <span className="text-foreground">Waivers & house rules.</span>{" "}
            Attendees agree to event-specific conduct rules and sign a waiver
            before they receive access details. No signed waiver means no
            access.
          </li>
          <li>
            <span className="text-foreground">Host & venue compliance.</span>{" "}
            Hosts submit venue documentation, public liability insurance, and
            permits which are reviewed before an event is published.
          </li>
          <li>
            <span className="text-foreground">Ongoing conduct history.</span>{" "}
            A single credible safety report is enough to pause an account
            while we investigate. Confirmed violations follow the member
            permanently.
          </li>
        </ul>
      </Section>

      <Section eyebrow="Reporting" title="If something isn't right">
        <p>
          If you experience or witness a breach of these standards — before,
          during, or after an event — tell us. You can flag any RSVP, message
          the host, or contact the safety team directly. Reports are
          confidential, and you will never be penalised for raising a concern
          in good faith.
        </p>
        <p>
          These standards apply to everyone equally. There are no VIPs, and
          there are no exceptions.
        </p>
      </Section>

      <div className="mx-auto max-w-3xl px-5 py-12 text-center">
        <Link
          to="/"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Back to home
        </Link>
      </div>
    </main>
  );
}
