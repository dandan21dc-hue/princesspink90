import { useState } from "react";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentPolicyVersion, listEventDocuments, listMyPolicyAgreements } from "@/lib/host.functions";
import { isDocumentStale } from "@/lib/complianceStale";


export type EventFormValues = {
  title: string;
  tagline: string;
  description: string;
  venue_name: string;
  address: string;
  city: string;
  starts_at: string;
  ends_at: string;
  dress_code: string;
  theme: string;
  capacity: string;
  ticket_price_cents: string;
  cover_image_url: string;
  is_private: boolean;
  published: boolean;
  // Venue compliance
  permits_confirmed: boolean;
  permit_details: string;
  insurance_confirmed: boolean;
  insurance_provider: string;
  insurance_policy_number: string;
  insurance_expires_on: string;
  legal_capacity: string;
  capacity_confirmed: boolean;
  compliance_notes: string;
  waiver_text: string;
};

export function emptyForm(): EventFormValues {
  return {
    title: "", tagline: "", description: "",
    venue_name: "", address: "", city: "",
    starts_at: "", ends_at: "",
    dress_code: "", theme: "",
    capacity: "", ticket_price_cents: "0",
    cover_image_url: "",
    is_private: false, published: true,
    permits_confirmed: false, permit_details: "",
    insurance_confirmed: false, insurance_provider: "",
    insurance_policy_number: "", insurance_expires_on: "",
    legal_capacity: "", capacity_confirmed: false,
    compliance_notes: "",
    waiver_text: "",
  };
}

export function toPayload(v: EventFormValues) {
  if (!v.title || !v.venue_name || !v.starts_at) {
    throw new Error("Title, venue and start time are required.");
  }
  const capacity = v.capacity ? parseInt(v.capacity, 10) : null;
  const legalCap = v.legal_capacity ? parseInt(v.legal_capacity, 10) : null;
  if (capacity != null && legalCap != null && capacity > legalCap) {
    throw new Error("Event capacity cannot exceed the venue's legal capacity.");
  }
  if (v.published && !(v.permits_confirmed && v.insurance_confirmed && v.capacity_confirmed)) {
    throw new Error("Confirm permits, insurance, and capacity before publishing. See /compliance for what's required, or uncheck 'Published' to save as draft.");
  }

  return {
    title: v.title.trim(),
    tagline: v.tagline.trim() || null,
    description: v.description.trim() || null,
    venue_name: v.venue_name.trim(),
    address: v.address.trim() || null,
    city: v.city.trim() || null,
    starts_at: new Date(v.starts_at).toISOString(),
    ends_at: v.ends_at ? new Date(v.ends_at).toISOString() : null,
    dress_code: v.dress_code.trim() || null,
    theme: v.theme.trim() || null,
    capacity,
    ticket_price_cents: v.ticket_price_cents ? parseInt(v.ticket_price_cents, 10) : 0,
    cover_image_url: v.cover_image_url.trim() || null,
    is_private: v.is_private,
    published: v.published,
    permits_confirmed: v.permits_confirmed,
    permit_details: v.permit_details.trim() || null,
    insurance_confirmed: v.insurance_confirmed,
    insurance_provider: v.insurance_provider.trim() || null,
    insurance_policy_number: v.insurance_policy_number.trim() || null,
    insurance_expires_on: v.insurance_expires_on || null,
    legal_capacity: legalCap,
    capacity_confirmed: v.capacity_confirmed,
    compliance_notes: v.compliance_notes.trim() || null,
    ...(v.waiver_text.trim() ? { waiver_text: v.waiver_text.trim() } : {}),
  };
}


export function EventForm({
  initial, onSubmit, submitting, submitLabel, eventId,
}: {
  initial?: Partial<EventFormValues>;
  onSubmit: (v: EventFormValues) => void | Promise<void>;
  submitting?: boolean;
  submitLabel: string;
  eventId?: string;
}) {
  const [v, setV] = useState<EventFormValues>({ ...emptyForm(), ...initial });
  const bind = <K extends keyof EventFormValues>(k: K) => ({
    value: v[k] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV({ ...v, [k]: e.target.value }),
  });

  const policyFn = useServerFn(getCurrentPolicyVersion);
  const listDocsFn = useServerFn(listEventDocuments);
  const listAgreementsFn = useServerFn(listMyPolicyAgreements);
  const policy = useQuery({
    queryKey: ["compliance-policy-current"],
    queryFn: () => policyFn(),
  });
  const docs = useQuery({
    queryKey: ["event-documents", eventId],
    queryFn: () => listDocsFn({ data: { event_id: eventId! } }),
    enabled: !!eventId,
  });
  const agreements = useQuery({
    queryKey: ["my-policy-agreements", eventId],
    queryFn: () => listAgreementsFn({ data: { event_id: eventId! } }),
    enabled: !!eventId,
  });

  const currentPolicyId = policy.data?.id ?? null;
  const currentPolicyVersion = policy.data?.version ?? null;
  const hasAgreedToCurrent =
    !!currentPolicyId &&
    !!agreements.data?.some((a) => a.policy_version_id === currentPolicyId);
  const REQUIRED_DOCS: { type: "permit" | "insurance" | "capacity"; label: string }[] = [
    { type: "permit", label: "Event permit" },
    { type: "insurance", label: "Insurance certificate" },
    { type: "capacity", label: "Capacity certificate" },
  ];
  const docList = docs.data ?? [];
  const missingDocs = eventId
    ? REQUIRED_DOCS.filter((r) => !docList.some((d) => d.doc_type === r.type))
    : [];
  const staleDocs = eventId
    ? docList.filter(
        (d) =>
          (d.doc_type === "permit" || d.doc_type === "insurance" || d.doc_type === "capacity") &&
          isDocumentStale({
            docPolicyVersionId: d.policy_version_id,
            currentPolicyVersionId: currentPolicyId,
            reAcknowledged: hasAgreedToCurrent,
          }),
      )
    : [];



  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        try { await onSubmit(v); } catch (err) { toast.error(err instanceof Error ? err.message : "Error"); }
      }}
      className="space-y-6"
    >
      <Section title="The night">
        <Field label="Title *"><input className={inputCls} required {...bind("title")} placeholder="Velvet Hours" /></Field>
        <Field label="Tagline"><input className={inputCls} {...bind("tagline")} placeholder="One line that sells it" /></Field>
        <Field label="Description">
          <textarea rows={6} className={inputCls} {...bind("description")} placeholder="What guests should expect. Consent, safety, house rules." />
        </Field>
      </Section>

      <Section title="Where & when">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Venue name *"><input className={inputCls} required {...bind("venue_name")} /></Field>
          <Field label="City"><input className={inputCls} {...bind("city")} /></Field>
        </div>
        <Field label="Address"><input className={inputCls} {...bind("address")} placeholder="Shared with confirmed guests only" /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Starts *"><input type="datetime-local" required className={inputCls} {...bind("starts_at")} /></Field>
          <Field label="Ends"><input type="datetime-local" className={inputCls} {...bind("ends_at")} /></Field>
        </div>
      </Section>

      <Section title="Style">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Dress code"><input className={inputCls} {...bind("dress_code")} placeholder="Black tie / fetish chic" /></Field>
          <Field label="Theme"><input className={inputCls} {...bind("theme")} placeholder="Neon confessional" /></Field>
        </div>
        <Field label="Cover image URL">
          <input className={inputCls} {...bind("cover_image_url")} placeholder="https://…" />
        </Field>
      </Section>

      <Section title="Access & entry">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Capacity"><input type="number" min={1} className={inputCls} {...bind("capacity")} /></Field>
          <Field label="Entry price (cents, 0 = free)"><input type="number" min={0} className={inputCls} {...bind("ticket_price_cents")} /></Field>
        </div>
        <div className="flex flex-wrap gap-4">
          <Toggle checked={v.is_private} onChange={(c) => setV({ ...v, is_private: c })} label="Private — hidden from public marquee, unlock by code only" />
          <Toggle checked={v.published} onChange={(c) => setV({ ...v, published: c })} label="Published (uncheck to save as draft)" />
        </div>
      </Section>

      <Section title="Venue compliance">
        <p className="text-xs text-muted-foreground">
          Confirm each item below before publishing. Guests deserve a safe, legal night.{" "}
          <Link to="/compliance" target="_blank" className="text-primary underline underline-offset-2 hover:brightness-125">
            Review the compliance policy →
          </Link>
        </p>

        {v.published && !(v.permits_confirmed && v.insurance_confirmed && v.capacity_confirmed) && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
            <div className="font-semibold uppercase tracking-widest">Publish blocked</div>
            <p className="mt-1">
              Permits, insurance, and capacity must all be confirmed before this event can be published.
              Uncheck "Published" to save as a draft while you gather the required documents.
            </p>
            {currentPolicyVersion && (
              <p className="mt-2">
                Current compliance policy:{" "}
                <span className="font-semibold text-amber-100">v{currentPolicyVersion}</span>
                {eventId ? " — documents must be uploaded under this version." : "."}
              </p>
            )}
            {eventId && missingDocs.length > 0 && (
              <div className="mt-2">
                <div className="font-semibold text-amber-100">Missing documents</div>
                <ul className="mt-1 list-disc pl-5">
                  {missingDocs.map((d) => (
                    <li key={d.type}>{d.label} — not uploaded yet</li>
                  ))}
                </ul>
              </div>
            )}
            {eventId && staleDocs.length > 0 && (
              <div className="mt-2">
                <div className="font-semibold text-amber-100">Stale documents</div>
                <ul className="mt-1 list-disc pl-5">
                  {staleDocs.map((d) => (
                    <li key={d.id}>
                      {d.doc_type} was uploaded under policy v{d.policy_version_label ?? "?"} — re-upload under v{currentPolicyVersion}.
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Link to="/compliance" target="_blank" className="mt-2 inline-block font-semibold text-amber-100 underline underline-offset-2">
              See what documents are required →
            </Link>
          </div>
        )}



        <div className="rounded-lg border border-border/60 p-4 space-y-3">
          <Toggle
            checked={v.permits_confirmed}
            onChange={(c) => setV({ ...v, permits_confirmed: c })}
            label="Permits secured (event, liquor, noise, etc.)"
          />
          <Field label="Permit numbers / notes">
            <textarea rows={2} className={inputCls} {...bind("permit_details")} placeholder="e.g. Event permit #12345 (city), TABC license #ABC…" />
          </Field>
        </div>

        <div className="rounded-lg border border-border/60 p-4 space-y-3">
          <Toggle
            checked={v.insurance_confirmed}
            onChange={(c) => setV({ ...v, insurance_confirmed: c })}
            label="Liability insurance in force for this event"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Insurance provider"><input className={inputCls} {...bind("insurance_provider")} placeholder="e.g. Hiscox" /></Field>
            <Field label="Policy number"><input className={inputCls} {...bind("insurance_policy_number")} /></Field>
          </div>
          <Field label="Policy expires on">
            <input type="date" className={inputCls} {...bind("insurance_expires_on")} />
          </Field>
        </div>

        <div className="rounded-lg border border-border/60 p-4 space-y-3">
          <Toggle
            checked={v.capacity_confirmed}
            onChange={(c) => setV({ ...v, capacity_confirmed: c })}
            label="Capacity verified against venue's legal max"
          />
          <Field label="Venue legal max capacity">
            <input type="number" min={1} className={inputCls} {...bind("legal_capacity")} placeholder="From the venue's occupancy certificate" />
          </Field>
          {v.capacity && v.legal_capacity && parseInt(v.capacity, 10) > parseInt(v.legal_capacity, 10) && (
            <p className="text-xs text-red-400">
              Event capacity ({v.capacity}) exceeds the venue's legal max ({v.legal_capacity}).
            </p>
          )}
        </div>

        <Field label="Compliance notes (internal)">
          <textarea rows={3} className={inputCls} {...bind("compliance_notes")} placeholder="Fire marshal walkthrough date, security staffing, medical on-site, etc." />
        </Field>
      </Section>

      <Section title="Liability waiver">
        <p className="text-xs text-muted-foreground">
          Every guest must accept this waiver and sign their name before the RSVP is confirmed. Leave blank to use the platform default waiver.
        </p>
        <Field label="Waiver text (optional override)">
          <textarea rows={8} className={inputCls} {...bind("waiver_text")} placeholder="Leave blank to use the platform default waiver…" />
        </Field>
      </Section>




      <button
        type="submit" disabled={submitting}
        className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:opacity-60"
      >
        {submitting ? "Saving…" : submitLabel}
      </button>
    </form>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm focus:border-primary focus:outline-none";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card/60 p-6">
      <div className="text-[10px] uppercase tracking-[0.3em] text-primary mb-4">{title}</div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1.5 text-xs text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (c: boolean) => void; label: string }) {
  return (
    <label className="flex items-center gap-3 text-sm cursor-pointer">
      <span className={`inline-flex h-5 w-9 items-center rounded-full transition ${checked ? "bg-primary" : "bg-secondary"}`}>
        <span className={`h-4 w-4 rounded-full bg-background shadow transition ${checked ? "translate-x-4" : "translate-x-0.5"}`} />
      </span>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="sr-only" />
      <span>{label}</span>
    </label>
  );
}
