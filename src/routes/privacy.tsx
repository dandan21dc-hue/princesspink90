import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — Health & Personal Data Handling" },
      {
        name: "description",
        content:
          "How we collect, store, use, and delete personal and sensitive health information under the Australian Privacy Act 1988.",
      },
      { property: "og:title", content: "Privacy Policy" },
      {
        property: "og:description",
        content:
          "Our commitments on personal and sensitive health information handling, retention, and access.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: "https://princesspink90.lovable.app/privacy" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [{ rel: "canonical", href: "https://princesspink90.lovable.app/privacy" }],
  }),
  component: PrivacyPage,
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
    <section className="border-t border-border/50 py-12">
      <div className="mx-auto max-w-3xl px-5">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">{eyebrow}</div>
        <h2 className="mt-3 font-display text-3xl font-semibold">{title}</h2>
        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
          {children}
        </div>
      </div>
    </section>
  );
}

function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-3xl px-5 pt-20 pb-10">
        <Link
          to="/"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Link>
        <div className="mt-8 text-xs uppercase tracking-[0.3em] text-primary">Policy</div>
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">Privacy Policy</h1>
        <p className="mt-3 text-xs uppercase tracking-widest text-muted-foreground">
          Last updated: {LAST_UPDATED}
        </p>
        <p className="mt-6 text-[15px] leading-relaxed text-muted-foreground">
          This page is maintained by the platform operator to explain how personal
          information — including <span className="text-foreground">sensitive
          information</span> such as sexual health screening results — is handled under
          the Australian <span className="text-foreground">Privacy Act 1988 (Cth)</span>{" "}
          and the Australian Privacy Principles (APPs). It is not legal advice; consult
          your own counsel for how the Act applies to you.
        </p>
      </header>

      <Section eyebrow="Scope" title="Who this policy covers">
        <p>
          This policy applies to everyone who signs in to the platform: event hosts,
          venue operators, cohosts, and guests. It covers information collected through
          the site, event flows, RSVPs, ID and age verification, and voluntary health
          screenings uploaded as part of specific event eligibility checks.
        </p>
      </Section>

      <Section eyebrow="What we collect" title="Categories of information">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-foreground">Account data</span> — email, display name,
            and authentication metadata provided by you or your identity provider.
          </li>
          <li>
            <span className="text-foreground">Event data</span> — events you create,
            RSVP to, or attend; compliance documents you upload as a host.
          </li>
          <li>
            <span className="text-foreground">Age verification</span> — proof-of-age
            evidence you upload, stored in a private bucket accessible only to reviewers.
          </li>
          <li>
            <span className="text-foreground">
              Sensitive information — sexual health screening results
            </span>{" "}
            — where an event requires it, you may voluntarily upload a recent STI/STD
            test result. This is classified as sensitive information under the Privacy
            Act and is treated to a higher standard of protection than ordinary personal
            information.
          </li>
        </ul>
      </Section>

      <Section eyebrow="Health data — the details" title="Why we collect health screenings, and how they are handled">
        <p>
          Some events on the platform have an operator-set health-screening
          requirement. In those cases, guests are asked to upload a recent test result
          so a reviewer can confirm the result is current before granting event access.
          Uploading a screening is <span className="text-foreground">voluntary</span> and
          gated by explicit consent at upload time; if you do not consent, you cannot
          RSVP to events that require it, but no other feature is affected.
        </p>
        <p>
          <span className="text-foreground">Purpose (APP 3, APP 6):</span> screenings are
          used solely to confirm eligibility for events that require them. They are not
          used for advertising, profiling, research, training AI models, or any secondary
          purpose.
        </p>
        <p>
          <span className="text-foreground">Storage (APP 11.1):</span> screening files
          are stored in a private storage bucket that is not publicly accessible. Files
          are transmitted over TLS and stored encrypted at rest by the underlying
          storage provider. Access is enforced at the database and object-storage layer:
          only the uploading user and the platform's designated reviewer/admin role can
          read a given file. Ordinary staff, other guests, event hosts, and unauthenticated
          visitors cannot access screening files.
        </p>
        <p>
          <span className="text-foreground">Retention (APP 11.2):</span> screenings
          carry a fixed <span className="text-foreground">90-day validity window</span>{" "}
          from the test date. Once a screening's validity window ends, it is
          automatically purged by a daily background job: the underlying file is deleted
          from private storage and the database record is removed. A minimal audit log
          (screening id, user id, test date, validity date, purge reason, purge
          timestamp) is retained to demonstrate compliance with this deletion; the audit
          log does not contain the health result itself and is readable only by the
          admin role. Pending screenings older than 90 days and rejected screenings
          older than 30 days from review are purged on the same schedule.
        </p>
        <p>
          <span className="text-foreground">Disclosure (APP 6):</span> we do not sell,
          rent, share, or otherwise disclose health information to third parties. The
          only exceptions are (a) as required by Australian law (e.g. a lawful court
          order or regulator request) and (b) to the underlying storage and database
          infrastructure provider that hosts the platform, which processes data on our
          behalf under contractual confidentiality obligations and does not use it for
          its own purposes.
        </p>
      </Section>

      <Section eyebrow="Access & correction" title="Your rights over your data">
        <p>
          Under APP 12 and APP 13 you have the right to request access to the personal
          information we hold about you, and to correct information that is inaccurate,
          out of date, incomplete, or misleading. You can:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            View and download your own uploaded screenings, ID verifications, event
            compliance documents, and account details from your account area at any time.
          </li>
          <li>
            Delete a pending screening yourself before it has been reviewed.
          </li>
          <li>
            Request full deletion of your account and associated data by contacting the
            platform operator via the channels listed in the site footer. We will action
            deletion requests within a reasonable time subject to any overriding legal
            retention obligations (e.g. financial records required by law).
          </li>
        </ul>
      </Section>

      <Section eyebrow="Security" title="How we protect your data">
        <p>
          Access to sensitive tables and storage buckets is enforced by row-level
          security policies at the database layer — not just in the application code —
          so that a bug in the frontend cannot expose data across users. Health
          screening files sit in a private storage bucket with per-user path scoping;
          only the uploading user and the admin/reviewer role can read a given file.
          Administrator actions on screenings (approvals, rejections) are attributed to
          the reviewing account.
        </p>
        <p>
          Despite these controls, no system is perfectly secure. If we become aware of
          an eligible data breach involving your personal or sensitive information, we
          will notify you and the Office of the Australian Information Commissioner
          (OAIC) as required by the Notifiable Data Breaches scheme.
        </p>
      </Section>

      <Section eyebrow="Cookies & analytics" title="What runs in your browser">
        <p>
          We use a small number of first-party cookies and browser storage entries that
          are strictly necessary to keep you signed in and to remember settings such as
          your age-gate acknowledgement. We do not use these for cross-site advertising.
          Any analytics we run is aggregated and does not attempt to identify individual
          users beyond the account you are signed into.
        </p>
      </Section>

      <Section eyebrow="Contact" title="Questions, requests & complaints">
        <p>
          To make a privacy request — access, correction, deletion — or to raise a
          concern about how your data has been handled, contact the platform operator
          through the channels listed in the site footer. If you are not satisfied with
          our response, you have the right to lodge a complaint with the Office of the
          Australian Information Commissioner (OAIC) at{" "}
          <a
            href="https://www.oaic.gov.au/"
            className="text-primary hover:underline"
            target="_blank"
            rel="noreferrer noopener"
          >
            oaic.gov.au
          </a>
          .
        </p>
      </Section>

      <Section eyebrow="Changes" title="Updates to this policy">
        <p>
          We may update this policy from time to time. Material changes to how health
          data is handled will be surfaced in-app before they take effect. The "Last
          updated" date at the top of this page reflects the most recent change.
        </p>
      </Section>

      <footer className="border-t border-border/50 py-10">
        <div className="mx-auto max-w-3xl px-5 text-xs text-muted-foreground">
          Related:{" "}
          <Link to="/compliance" className="text-primary hover:underline">
            Venue &amp; event compliance
          </Link>
          . This page is maintained by the platform operator and is not legal advice.
        </div>
      </footer>
    </main>
  );
}
