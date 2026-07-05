import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getCurrentPolicyVersion, listPolicyVersions } from "@/lib/host.functions";

export const Route = createFileRoute("/compliance")({
  head: () => ({
    meta: [
      { title: "Venue & Event Compliance — Requirements & Documents" },
      {
        name: "description",
        content:
          "What venues and hosts must submit to run compliant events on our platform: permits, insurance, capacity, and safety confirmations.",
      },
      { property: "og:title", content: "Venue & Event Compliance" },
      {
        property: "og:description",
        content:
          "Requirements, required documents, and the review process for venues and event hosts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CompliancePage,
});

function Section({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border/50 py-14">
      <div className="mx-auto max-w-3xl px-5">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">{eyebrow}</div>
        <h2 className="mt-3 font-display text-3xl font-semibold">{title}</h2>
        <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-muted-foreground">{children}</div>
      </div>
    </section>
  );
}

function DocCard({
  tag,
  title,
  desc,
  accepts,
}: {
  tag: string;
  title: string;
  desc: string;
  accepts: string;
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="text-[10px] uppercase tracking-[0.25em] text-primary">{tag}</div>
      <div className="mt-2 font-display text-lg font-semibold text-foreground">{title}</div>
      <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
      <p className="mt-3 text-xs text-muted-foreground/80">
        <span className="text-foreground/80">Accepted:</span> {accepts}
      </p>
    </div>
  );
}

function CompliancePage() {
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
        <h1 className="mt-3 font-display text-4xl font-semibold sm:text-5xl">
          Venue &amp; Event Compliance
        </h1>
        <p className="mt-5 text-[15px] leading-relaxed text-muted-foreground">
          Every event listed on the platform is reviewed against a shared safety and
          legality baseline. This page explains what hosts and venues must provide, how
          documents are stored, and what happens during review. This page is maintained
          by the platform operator and does not replace local law or advice from your
          own counsel.
        </p>
        <PolicyVersionBanner />
      </header>

      <Section eyebrow="Overview" title="Who this applies to">
        <p>
          Anyone hosting a ticketed or RSVP event at a physical venue — whether the
          space is owned, rented, or borrowed. Fully private, non-ticketed gatherings
          are out of scope, but if you sell access, take RSVPs, or promote publicly on
          the platform, the compliance checklist applies.
        </p>
        <p>
          Hosts are responsible for the accuracy of anything submitted. Venue operators
          are responsible for maintaining valid permits and insurance for the space.
        </p>
      </Section>

      <Section eyebrow="Requirements" title="Baseline requirements for every event">
        <ul className="list-disc space-y-2 pl-5">
          <li>A named, contactable host and venue operator.</li>
          <li>A stated legal capacity that matches the venue's permit.</li>
          <li>Valid public liability insurance covering the event date.</li>
          <li>All permits required by the local jurisdiction (see below).</li>
          <li>A signed liability waiver flow enabled for guest RSVPs.</li>
          <li>Accurate age restrictions, accessibility notes, and safety contacts.</li>
        </ul>
      </Section>

      <Section eyebrow="Documents" title="Required documents">
        <p>
          Upload these in the event editor under <span className="text-foreground">Compliance documents</span>.
          Files are stored in a private bucket and are only accessible to the host and
          reviewers. Max 20&nbsp;MB each; PDF or image.
        </p>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <DocCard
            tag="Permit"
            title="Venue / event permit"
            desc="The operating permit, temporary event notice, or occupancy license issued by your local authority for the date of the event."
            accepts="PDF, JPG, PNG"
          />
          <DocCard
            tag="Insurance"
            title="Public liability insurance"
            desc="A certificate of insurance naming the venue and covering the event date. Coverage must not be expired at the time of the event."
            accepts="PDF"
          />
          <DocCard
            tag="Capacity"
            title="Capacity documentation"
            desc="Fire-marshal capacity letter, occupancy sign, or floor plan showing the legal maximum capacity for the space in the configuration you plan to use."
            accepts="PDF, JPG, PNG"
          />
        </div>
        <p className="mt-6">
          Additional documents may be requested for specific event types — e.g.
          alcohol service licenses, amplified sound permits, food handling
          certificates, or crowd management plans for larger capacities.
        </p>
      </Section>

      <Section eyebrow="Confirmations" title="Checklist confirmations">
        <p>
          During event creation, hosts confirm each of the following. These are audited
          alongside uploaded documents:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>The stated capacity does not exceed the venue's legal maximum.</li>
          <li>Insurance is active and covers the event date.</li>
          <li>All required permits are in hand for the jurisdiction.</li>
          <li>Emergency exits, first aid, and an on-site safety contact are in place.</li>
        </ul>
      </Section>

      <Section eyebrow="Review" title="How review works">
        <p>
          New events default to unpublished until all required documents are attached
          and the compliance checklist is complete. A reviewer verifies the submission
          and moves the event to one of three states:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <span className="text-foreground">Approved</span> — published and visible to
            guests. Insurance nearing expiry is flagged for follow-up.
          </li>
          <li>
            <span className="text-foreground">Pending</span> — awaiting a document or
            clarification from the host.
          </li>
          <li>
            <span className="text-foreground">Flagged</span> — a required item is
            missing, expired, or inconsistent (e.g. capacity above the legal maximum).
            The event cannot be published until resolved.
          </li>
        </ul>
      </Section>

      <Section eyebrow="Data" title="How your documents are handled">
        <p>
          Compliance documents are stored in a private storage bucket with access
          restricted to the uploading host, the venue operator, and platform
          reviewers. Documents are retained for the lifetime of the event plus a
          rolling audit window, and are deleted on request once retention obligations
          have lapsed. See the Privacy policy for full details.
        </p>
      </Section>

      <Section eyebrow="Contact" title="Questions or appeals">
        <p>
          If an event has been flagged and you believe the decision is incorrect, reply
          to the review notification with supporting documents. For general questions
          about compliance requirements, contact the platform operator through the
          channels listed on the site footer.
        </p>
      </Section>

      <footer className="border-t border-border/50 py-10">
        <div className="mx-auto max-w-3xl px-5 text-xs text-muted-foreground">
          This page is maintained by the platform operator and is provided for
          transparency. It is not legal advice.
        </div>
      </footer>
    </main>
  );
}

function PolicyVersionBanner() {
  const currentFn = useServerFn(getCurrentPolicyVersion);
  const listFn = useServerFn(listPolicyVersions);
  const current = useQuery({ queryKey: ["compliance-policy-current"], queryFn: () => currentFn() });
  const list = useQuery({ queryKey: ["compliance-policy-list"], queryFn: () => listFn() });

  if (current.isLoading) return null;
  if (!current.data) return null;

  return (
    <div className="mt-6 rounded-xl border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
          Current policy · v{current.data.version}
        </div>
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
          Effective {new Date(current.data.effective_at).toLocaleDateString()}
        </div>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{current.data.summary}</p>
      {current.data.body && (
        <div className="mt-4 whitespace-pre-wrap rounded-md border border-border/40 bg-background/40 p-3 text-sm leading-relaxed text-muted-foreground">
          {current.data.body}
        </div>
      )}
      {list.data && list.data.length > 1 && (
        <details className="mt-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
            Version history ({list.data.length})
          </summary>
          <ul className="mt-2 space-y-1">
            {list.data.map((v) => (
              <li key={v.id} className="flex items-center gap-2">
                <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                  v.is_current ? "bg-emerald-500/15 text-emerald-400" : "bg-muted/40"
                }`}>
                  v{v.version}
                </span>
                <span>{new Date(v.effective_at).toLocaleDateString()}</span>
                {v.is_current && <span className="text-emerald-400">· current</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
