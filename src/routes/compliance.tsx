import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  getCurrentPolicyVersion,
  listPolicyVersions,
  listMyComplianceDocuments,
  recordPolicyAgreement,
  signEventDocumentUrl,
} from "@/lib/host.functions";

import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DocumentPreviewDialog } from "@/components/DocumentPreviewDialog";
import { Loader2 } from "lucide-react";
import { isDocumentStale } from "@/lib/complianceStale";



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

      <MyDocumentsSection />

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

function useIsSignedIn() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.auth.getUser().then(({ data }) => {
      if (alive) setSignedIn(!!data.user);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      setSignedIn(!!session?.user);
    });
    return () => { alive = false; sub.subscription.unsubscribe(); };
  }, []);
  return signedIn;
}

function DocTypeLabel({ type }: { type: string }) {
  const map: Record<string, string> = {
    permit: "Permit",
    insurance: "Insurance",
    capacity: "Capacity",
    other: "Other",
  };
  return <span>{map[type] ?? type}</span>;
}

function MyDocumentsSection() {
  const signedIn = useIsSignedIn();
  const listFn = useServerFn(listMyComplianceDocuments);
  const currentFn = useServerFn(getCurrentPolicyVersion);
  const versionsFn = useServerFn(listPolicyVersions);
  const docs = useQuery({
    queryKey: ["my-compliance-documents"],
    queryFn: () => listFn(),
    enabled: signedIn === true,
  });
  const current = useQuery({
    queryKey: ["compliance-policy-current"],
    queryFn: () => currentFn(),
  });
  const versions = useQuery({
    queryKey: ["compliance-policy-list"],
    queryFn: () => versionsFn(),
  });

  const qc = useQueryClient();
  const reAckFn = useServerFn(recordPolicyAgreement);

  // Reconcile every cache surface that depends on policy-agreement state.
  // Awaited so callers (mutation onSettled) block on server reconciliation
  // — the button stays in the "Recording…" state until real data lands,
  // guaranteeing the UI matches the server before the user can act again.
  async function reconcileAgreementCaches(eventIds: (string | null)[] = []) {
    const uniqueEventIds = Array.from(new Set(eventIds));
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["my-compliance-documents"], refetchType: "active" }),
      qc.invalidateQueries({ queryKey: ["compliance-policy-current"], refetchType: "active" }),
      qc.invalidateQueries({ queryKey: ["compliance-policy-list"], refetchType: "active" }),
      ...uniqueEventIds.map((eid) =>
        eid
          ? qc.invalidateQueries({
              queryKey: ["my-policy-agreements", eid],
              refetchType: "active",
            })
          : Promise.resolve(),
      ),
    ]);
  }

  const reAck = useMutation({
    mutationFn: (vars: { policy_version_id: string; event_id: string | null }) =>
      reAckFn({ data: vars }),
    onMutate: async (vars) => {
      // Optimistically flip the affected docs so the stale-row UI updates
      // immediately without waiting for the server round-trip.
      await qc.cancelQueries({ queryKey: ["my-compliance-documents"] });
      const key = ["my-compliance-documents"] as const;
      const previous = qc.getQueryData<any[]>(key);
      const nowIso = new Date().toISOString();
      const currentLabel = current.data?.version ?? null;
      if (previous) {
        qc.setQueryData<any[]>(
          key,
          previous.map((row) =>
            row.event_id === vars.event_id
              ? {
                  ...row,
                  current_policy_version_id: vars.policy_version_id,
                  current_policy_version_label:
                    row.current_policy_version_label ?? currentLabel,
                  current_agreement_accepted_at: nowIso,
                  current_agreement_accepted_by_display_name:
                    row.current_agreement_accepted_by_display_name ??
                    row.uploaded_by_display_name ??
                    null,
                }
              : row,
          ),
        );
      }
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      // Roll back the optimistic patch to the last known server truth,
      // then still trigger a refetch in onSettled so we don't drift if the
      // failure happened after the server already persisted.
      if (ctx?.previous) qc.setQueryData(["my-compliance-documents"], ctx.previous);
      toast.error(e instanceof Error ? e.message : "Could not re-acknowledge policy");
    },
    onSuccess: () => {
      toast.success("Re-acknowledged current compliance policy for this event.");
    },
    onSettled: async (_res, _err, vars) => {
      await reconcileAgreementCaches(vars ? [vars.event_id] : []);
    },
  });

  const [confirmTarget, setConfirmTarget] = useState<{
    doc_id: string;
    event_id: string | null;
    event_title: string | null;
    file_name: string;
    old_version: string | null;
  } | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  const bulkReAck = useMutation({
    mutationFn: async (vars: { policy_version_id: string; event_ids: (string | null)[] }) => {
      const results = await Promise.allSettled(
        vars.event_ids.map((event_id) =>
          reAckFn({ data: { policy_version_id: vars.policy_version_id, event_id } }),
        ),
      );
      const failed = results.filter((r) => r.status === "rejected").length;
      return { total: vars.event_ids.length, failed };
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: ["my-compliance-documents"] });
      const key = ["my-compliance-documents"] as const;
      const previous = qc.getQueryData<any[]>(key);
      const nowIso = new Date().toISOString();
      const currentLabel = current.data?.version ?? null;
      const eventSet = new Set(vars.event_ids);
      if (previous) {
        qc.setQueryData<any[]>(
          key,
          previous.map((row) =>
            eventSet.has(row.event_id)
              ? {
                  ...row,
                  current_policy_version_id: vars.policy_version_id,
                  current_policy_version_label:
                    row.current_policy_version_label ?? currentLabel,
                  current_agreement_accepted_at: nowIso,
                  current_agreement_accepted_by_display_name:
                    row.current_agreement_accepted_by_display_name ??
                    row.uploaded_by_display_name ??
                    null,
                }
              : row,
          ),
        );
      }
      return { previous };
    },
    onError: (e, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(["my-compliance-documents"], ctx.previous);
      toast.error(e instanceof Error ? e.message : "Bulk re-acknowledge failed");
    },
    onSuccess: (res) => {
      const ok = res.total - res.failed;
      if (res.failed === 0) {
        toast.success(`Re-acknowledged current policy for ${ok} event${ok === 1 ? "" : "s"}.`);
      } else {
        toast.warning(`Re-acknowledged ${ok} of ${res.total}. ${res.failed} failed — please retry.`);
      }
      setSelected(new Set());
    },
    onSettled: async (res, _err, vars) => {
      // Await reconciliation so the modal only closes after the UI reflects
      // the actual server state — never on an unverified optimistic patch.
      await reconcileAgreementCaches(vars?.event_ids ?? []);
      if (res && res.failed === 0) setBulkConfirmOpen(false);
    },
  });

  const signFn = useServerFn(signEventDocumentUrl);
  const [previewTarget, setPreviewTarget] = useState<{ id: string; file_name: string } | null>(null);
  async function openDoc(id: string, file_name: string) {
    setPreviewTarget({ id, file_name });
  }
  async function signUrlFor(id: string): Promise<string> {
    const { url } = await signFn({ data: { id } });
    return url;
  }
  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }




  const [versionFilter, setVersionFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const [sortKey, setSortKey] = useState<"uploaded_at" | "policy_version">("uploaded_at");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  if (!signedIn) return null;
  const allRows = docs.data ?? [];
  if (docs.isLoading) {
    return (
      <Section eyebrow="Your uploads" title="Documents you've submitted">
        <p className="text-sm text-muted-foreground">Loading your documents…</p>
      </Section>
    );
  }
  if (allRows.length === 0) {
    return (
      <Section eyebrow="Your uploads" title="Documents you've submitted">
        <p className="text-sm text-muted-foreground">
          You haven't uploaded any compliance documents yet. Documents are added from
          the event editor.
        </p>
      </Section>
    );
  }

  const currentId = current.data?.id ?? null;
  const currentVersion = current.data?.version ?? null;

  const fromTs = fromDate ? new Date(fromDate + "T00:00:00").getTime() : null;
  const toTs = toDate ? new Date(toDate + "T23:59:59.999").getTime() : null;
  const needle = q.trim().toLowerCase();
  const rows = allRows
    .filter((d) => {
      if (versionFilter && d.policy_version_id !== versionFilter) return false;
      const t = new Date(d.uploaded_at).getTime();
      if (fromTs != null && t < fromTs) return false;
      if (toTs != null && t > toTs) return false;
      if (needle) {
        const hay = `${d.file_name} ${d.event_title ?? ""} ${d.doc_type} ${d.policy_version_label ?? ""}`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    })
    .slice()
    .sort((a, b) => {
      const dir = sortDir === "asc" ? 1 : -1;
      if (sortKey === "uploaded_at") {
        return (new Date(a.uploaded_at).getTime() - new Date(b.uploaded_at).getTime()) * dir;
      }
      // policy_version — numeric compare when possible, fallback to string
      const av = a.policy_version_label ?? "";
      const bv = b.policy_version_label ?? "";
      const an = Number(av);
      const bn = Number(bv);
      if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
      return av.localeCompare(bv) * dir;
    });

  const filtersActive = !!(versionFilter || fromDate || toDate || needle);

  return (
    <Section eyebrow="Your uploads" title="Documents you've submitted">
      <p className="text-sm text-muted-foreground">
        Each document is tagged with the compliance policy version that was in force
        when it was uploaded — that is the version you agreed to at the time.
      </p>

      <div className="mt-4 grid gap-3 rounded-xl border border-border/60 bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-xs">
          <div className="mb-1 uppercase tracking-widest text-muted-foreground">Search</div>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="File, event, or type…"
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs">
          <div className="mb-1 uppercase tracking-widest text-muted-foreground">Policy version</div>
          <select
            value={versionFilter}
            onChange={(e) => setVersionFilter(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="">All versions</option>
            {(versions.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version}
                {v.is_current ? " (current)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-xs">
          <div className="mb-1 uppercase tracking-widest text-muted-foreground">Uploaded from</div>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <label className="block text-xs">
          <div className="mb-1 uppercase tracking-widest text-muted-foreground">Uploaded to</div>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>
            Showing {rows.length} of {allRows.length}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <span className="uppercase tracking-widest">Sort</span>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as "uploaded_at" | "policy_version")}
              className="rounded-md border border-input bg-background px-2 py-1 text-xs"
              aria-label="Sort by"
            >
              <option value="uploaded_at">Upload date</option>
              <option value="policy_version">Policy version</option>
            </select>
            <button
              type="button"
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              className="rounded-md border border-input px-2 py-1 text-xs text-foreground hover:bg-muted/40"
              aria-label={`Toggle sort direction (currently ${sortDir === "asc" ? "ascending" : "descending"})`}
              title={sortDir === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
            >
              {sortKey === "uploaded_at"
                ? sortDir === "desc" ? "Newest first ↓" : "Oldest first ↑"
                : sortDir === "desc" ? "Highest first ↓" : "Lowest first ↑"}
            </button>
            {filtersActive && (
              <button
                type="button"
                onClick={() => { setVersionFilter(""); setFromDate(""); setToDate(""); setQ(""); }}
                className="text-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        </div>
      </div>

      {(() => {
        const eligible = rows.filter((d) =>
          isDocumentStale({
            docPolicyVersionId: d.policy_version_id,
            currentPolicyVersionId: currentId,
            reAcknowledged: d.current_agreement_accepted_at,
          }),
        );
        const eligibleIds = eligible.map((d) => d.id);
        const visibleSelected = eligibleIds.filter((id) => selected.has(id));
        const allSelected = eligibleIds.length > 0 && visibleSelected.length === eligibleIds.length;
        if (eligible.length === 0) return null;
        return (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs">
            <label className="flex items-center gap-2 text-foreground">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={(e) => {
                  setSelected((prev) => {
                    const next = new Set(prev);
                    if (e.target.checked) eligibleIds.forEach((id) => next.add(id));
                    else eligibleIds.forEach((id) => next.delete(id));
                    return next;
                  });
                }}
              />
              <span>
                Select all outdated ({eligible.length}) · {visibleSelected.length} selected
              </span>
            </label>
            <div className="flex items-center gap-2">
              {visibleSelected.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-muted-foreground hover:text-foreground"
                >
                  Clear
                </button>
              )}
              <button
                type="button"
                disabled={visibleSelected.length === 0 || !currentId || bulkReAck.isPending}
                onClick={() => setBulkConfirmOpen(true)}
                className="rounded-md bg-primary px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {bulkReAck.isPending
                  ? "Recording…"
                  : `Re-acknowledge v${currentVersion ?? "?"} for selected`}
              </button>
            </div>
          </div>
        );
      })()}

      {rows.length === 0 ? (
        <p className="mt-4 rounded-lg border border-border/60 bg-card p-4 text-sm text-muted-foreground">
          No documents match the current filters.
        </p>
      ) : (
        <ul className="mt-4 space-y-3">

        {rows.map((d) => {
          // Split the two related concepts:
          //   versionMismatch — the doc was uploaded under an older policy.
          //   needsReAck      — versionMismatch AND no re-ack recorded yet.
          // The amber "action needed" state uses `needsReAck`; the historical
          // "Re-acknowledged v{n}" pill uses `versionMismatch` so we still
          // show what happened once the user has actioned it.
          const versionMismatch = !!(
            currentId && d.policy_version_id && d.policy_version_id !== currentId
          );
          const needsReAck = isDocumentStale({
            docPolicyVersionId: d.policy_version_id,
            currentPolicyVersionId: currentId,
            reAcknowledged: d.current_agreement_accepted_at,
          });
          const canBulkSelect = needsReAck;
          return (
            <li
              key={d.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card p-4"
            >
              {canBulkSelect && (
                <input
                  type="checkbox"
                  aria-label={`Select ${d.file_name} for bulk re-acknowledgement`}
                  checked={selected.has(d.id)}
                  onChange={() => toggleSelected(d.id)}
                  className="mt-1 self-start"
                />
              )}
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-foreground/80">
                    <DocTypeLabel type={d.doc_type} />
                  </span>
                  <button
                    type="button"
                    onClick={() => openDoc(d.id, d.file_name)}
                    title="Preview document"
                    className="font-medium text-foreground truncate hover:text-primary underline-offset-2 hover:underline"
                  >
                    {d.file_name}
                  </button>
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {d.event_title ? <span>{d.event_title} ·</span> : null}
                  <span>Uploaded {new Date(d.uploaded_at).toLocaleString()}</span>
                  {d.uploaded_by_display_name ? <span>by {d.uploaded_by_display_name}</span> : null}
                  <span aria-hidden>·</span>
                  <button
                    type="button"
                    onClick={() => openDoc(d.id, d.file_name)}
                    className="text-primary hover:underline"
                  >
                    Preview →
                  </button>
                </div>

              </div>
              <div className="flex flex-col items-end gap-1 text-xs">
                {d.policy_version_label ? (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                      needsReAck
                        ? "bg-amber-500/15 text-amber-300"
                        : "bg-emerald-500/15 text-emerald-400"
                    }`}
                    title={
                      needsReAck && currentVersion
                        ? `Current policy is v${currentVersion}`
                        : "Agreed to current policy"
                    }
                  >
                    Agreed to policy v{d.policy_version_label}
                  </span>
                ) : (
                  <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                    No policy version recorded
                  </span>
                )}
                {versionMismatch && d.current_agreement_accepted_at && d.current_policy_version_label && (
                  <span
                    className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-emerald-400"
                    title={new Date(d.current_agreement_accepted_at).toISOString()}
                  >
                    Re-acknowledged v{d.current_policy_version_label}
                  </span>
                )}
                {d.agreement_accepted_at ? (
                  <span
                    className="text-muted-foreground"
                    title={new Date(d.agreement_accepted_at).toISOString()}
                  >
                    Accepted {new Date(d.agreement_accepted_at).toLocaleString()}
                    {d.agreement_accepted_by_display_name
                      ? ` by ${d.agreement_accepted_by_display_name}`
                      : ""}
                  </span>
                ) : (
                  <span className="text-amber-300">No agreement record on file</span>
                )}
                {versionMismatch && d.current_agreement_accepted_at && (
                  <span className="text-emerald-400">
                    Re-acknowledged {new Date(d.current_agreement_accepted_at).toLocaleString()}
                    {d.current_agreement_accepted_by_display_name
                      ? ` by ${d.current_agreement_accepted_by_display_name}`
                      : ""}
                  </span>
                )}
                {needsReAck && currentVersion && currentId && (
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-amber-300">
                      Current policy is v{currentVersion} — consider re-uploading.
                    </span>
                    <button
                      type="button"
                      disabled={reAck.isPending}
                      onClick={() =>
                        setConfirmTarget({
                          doc_id: d.id,
                          event_id: d.event_id,
                          event_title: d.event_title ?? null,
                          file_name: d.file_name,
                          old_version: d.policy_version_label ?? null,
                        })
                      }
                      className="rounded-md border border-primary/50 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-primary hover:bg-primary/10 disabled:opacity-50"
                    >
                      {reAck.isPending && reAck.variables?.event_id === d.event_id
                        ? "Recording…"
                        : `Re-acknowledge v${currentVersion}`}
                    </button>
                  </div>
                )}

              </div>

            </li>
          );
        })}
        </ul>
      )}
      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(open) => {
          if (!open && !reAck.isPending) setConfirmTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Re-acknowledge compliance policy v{currentVersion ?? "?"}?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>
                  This records a new agreement dated now under your account
                  {confirmTarget?.event_title ? (
                    <> for <span className="text-foreground">{confirmTarget.event_title}</span></>
                  ) : null}
                  {confirmTarget?.old_version ? (
                    <> (previously agreed to v{confirmTarget.old_version})</>
                  ) : null}
                  . The uploaded document&nbsp;
                  <span className="text-foreground">{confirmTarget?.file_name}</span> stays as-is —
                  re-upload it under the current policy when convenient.
                </p>
                <p className="text-xs">
                  Agreements are auditable and cannot be deleted.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={reAck.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={reAck.isPending || !currentId}
              aria-busy={reAck.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (reAck.isPending) return;
                if (!currentId || !confirmTarget) return;
                reAck.mutate(
                  { policy_version_id: currentId, event_id: confirmTarget.event_id },
                  { onSuccess: () => setConfirmTarget(null) },
                  // On failure: keep the modal open so the user can retry;
                  // the mutation's onError already surfaces a toast.
                );
              }}
              className="inline-flex items-center gap-2"
            >
              {reAck.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {reAck.isPending ? "Recording…" : `Record agreement to v${currentVersion ?? "?"}`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog
        open={bulkConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !bulkReAck.isPending) setBulkConfirmOpen(false);
        }}
      >
        <AlertDialogContent>
          {(() => {
            const selectedRows = (docs.data ?? []).filter((d) => selected.has(d.id));
            const uniqueEventIds = Array.from(new Set(selectedRows.map((d) => d.event_id)));
            return (
              <>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Re-acknowledge policy v{currentVersion ?? "?"} for {selectedRows.length}{" "}
                    document{selectedRows.length === 1 ? "" : "s"}?
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2 text-sm text-muted-foreground">
                      <p>
                        This records a new agreement dated now under your account for{" "}
                        <span className="text-foreground">{uniqueEventIds.length}</span>{" "}
                        event{uniqueEventIds.length === 1 ? "" : "s"}. Uploaded files stay as-is —
                        re-upload them under the current policy when convenient.
                      </p>
                      <p className="text-xs">Agreements are auditable and cannot be deleted.</p>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={bulkReAck.isPending}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={bulkReAck.isPending || !currentId || uniqueEventIds.length === 0}
                    aria-busy={bulkReAck.isPending}
                    onClick={(e) => {
                      e.preventDefault();
                      if (bulkReAck.isPending) return;
                      if (!currentId) return;
                      bulkReAck.mutate({
                        policy_version_id: currentId,
                        event_ids: uniqueEventIds,
                      });
                    }}
                    className="inline-flex items-center gap-2"
                  >
                    {bulkReAck.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                    {bulkReAck.isPending
                      ? `Recording ${uniqueEventIds.length}…`
                      : `Record ${uniqueEventIds.length} agreement${uniqueEventIds.length === 1 ? "" : "s"}`}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </>
            );
          })()}
        </AlertDialogContent>
      </AlertDialog>
      <DocumentPreviewDialog
        target={previewTarget}
        onOpenChange={(open) => { if (!open) setPreviewTarget(null); }}
        signUrl={signUrlFor}
      />
    </Section>

  );
}

