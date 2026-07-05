import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/legal")({
  head: () => ({
    meta: [
      { title: "Code of Conduct & Privacy Policy — Legal" },
      {
        name: "description",
        content:
          "Community rules and privacy commitments for every guest, host, and event on Princess Pink.",
      },
      { property: "og:title", content: "Code of Conduct & Privacy Policy" },
      {
        property: "og:description",
        content:
          "The consent-first rules of the room and how we handle your personal information.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://princesspink90.lovable.app/legal" },
    ],
    links: [{ rel: "canonical", href: "https://princesspink90.lovable.app/legal" }],
  }),
  component: LegalPage,
});

const LAST_UPDATED = "5 July 2026";

function LegalPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto max-w-3xl px-5 pt-16 pb-12">
          <Link
            to="/"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Home
          </Link>
          <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">Legal</div>
          <h1 className="mt-2 font-display text-4xl font-extrabold">
            Code of Conduct &amp; Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            These are the rules of the room and our commitments on your personal data.
            Every RSVP requires you to acknowledge that you have read and agree to both.
          </p>
          <p className="mt-2 text-[11px] uppercase tracking-widest text-muted-foreground">
            Last updated · {LAST_UPDATED}
          </p>
          <nav className="mt-5 flex flex-wrap gap-2 text-[11px] uppercase tracking-widest">
            <a
              href="#code-of-conduct"
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/20"
            >
              Code of Conduct
            </a>
            <a
              href="#privacy-policy"
              className="rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-primary hover:bg-primary/20"
            >
              Privacy Policy
            </a>
          </nav>
        </div>
      </header>

      <Section id="code-of-conduct" eyebrow="Section one" title="Code of Conduct">
        <p>
          Every event is consent-first. Read these rules before you RSVP — the door team
          enforces them, and breaches end your night without refund.
        </p>
        <h3>Consent is explicit, ongoing, and revocable</h3>
        <ul>
          <li>
            Ask before you touch. A "yes" to one thing is not a "yes" to another, and any
            person can withdraw consent at any moment — silence, hesitation, or intoxication
            is not consent.
          </li>
          <li>
            Respect stated limits, safewords, and negotiated scenes. Play only within what
            has been agreed with everyone involved.
          </li>
          <li>
            Consent given while incapacitated (by alcohol, drugs, exhaustion) is not valid.
            If in doubt, stop and check in.
          </li>
        </ul>
        <h3>Respect &amp; safety</h3>
        <ul>
          <li>No harassment, coercion, slurs, or discrimination of any kind.</li>
          <li>Keep aisles, exits, and safe spaces clear. Follow venue and host instructions.</li>
          <li>Alert a host or the door team immediately if you feel unsafe or witness a breach.</li>
        </ul>
        <h3>Discretion &amp; media</h3>
        <ul>
          <li>
            No photos, video, or audio recording of any guest without their explicit consent,
            recorded through the RSVP's video-consent choices.
          </li>
          <li>
            Do not share other guests' names, faces, presence, or identifying details outside
            the event.
          </li>
        </ul>
        <h3>Fitness to attend</h3>
        <ul>
          <li>All guests must be 18+ with verified ID on file.</li>
          <li>
            Where a health screening is required for an event, it must be current at the door.
          </li>
          <li>Do not attend if you are unwell or unable to give clear consent.</li>
        </ul>
        <h3>Enforcement</h3>
        <p>
          Breaches result in immediate removal, forfeiture of your ticket, and — depending on
          severity — a permanent ban and referral to authorities. Hosts have final say on the
          floor.
        </p>
      </Section>

      <Section id="privacy-policy" eyebrow="Section two" title="Privacy Policy">
        <p>
          We collect only what we need to run consent-first, safe events, and we delete it
          as soon as it stops being useful. This summary covers the essentials; the{" "}
          <Link to="/privacy" className="text-primary underline underline-offset-2 hover:text-neon">
            full Privacy Policy
          </Link>{" "}
          goes into detail on sensitive health data and your rights under the Australian
          Privacy Act 1988.
        </p>
        <h3>What we collect</h3>
        <ul>
          <li>Account details (email, display name) so you can sign in and RSVP.</li>
          <li>Age verification (ID capture) to confirm 18+ eligibility.</li>
          <li>Event RSVPs, ticket codes, and your video-consent choices per event.</li>
          <li>
            Where an event requires it: a current health screening document, treated as
            sensitive information.
          </li>
          <li>Signed liability waivers and compliance policy agreements per event.</li>
        </ul>
        <h3>How we use it</h3>
        <ul>
          <li>To verify eligibility, brief the door team, and enforce consent choices.</li>
          <li>To meet safety, compliance, and record-keeping obligations for our events.</li>
          <li>To contact you about the specific events you have RSVP'd to.</li>
        </ul>
        <h3>Who can see it</h3>
        <ul>
          <li>You can always view and manage your own records from your dashboard.</li>
          <li>
            Hosts and door staff see only what they need to run their event (your RSVP,
            waiver status, and consent choices).
          </li>
          <li>
            Administrators may access sensitive records only for compliance review and
            incident response.
          </li>
        </ul>
        <h3>Retention &amp; automatic deletion</h3>
        <ul>
          <li>Approved health screenings expire on their <em>valid until</em> date and are then purged automatically along with the file.</li>
          <li>Pending health submissions are purged after 90 days if not reviewed.</li>
          <li>Rejected health submissions are kept for 30 days after review, then purged.</li>
          <li>
            Only a small audit record (date, status, reason) is retained after a purge —
            never the file itself.
          </li>
        </ul>
        <h3>Your choices</h3>
        <ul>
          <li>You may cancel any RSVP and request deletion of your account at any time.</li>
          <li>You may update your video-consent choices by re-RSVPing before an event.</li>
          <li>
            To request access, correction, or deletion of your personal information, contact
            the host through the channels listed on the home page.
          </li>
        </ul>
      </Section>
    </main>
  );
}

function Section({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-border/50 py-12">
      <div className="mx-auto max-w-3xl px-5">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">{eyebrow}</div>
        <h2 className="mt-3 font-display text-3xl font-semibold">{title}</h2>
        <div className="prose prose-invert mt-6 max-w-none text-sm leading-relaxed text-muted-foreground [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:font-display [&_h3]:text-base [&_h3]:text-foreground [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1 [&_p]:mt-3">
          {children}
        </div>
      </div>
    </section>
  );
}
