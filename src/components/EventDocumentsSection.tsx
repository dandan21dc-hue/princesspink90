import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listEventDocuments, registerEventDocument, deleteEventDocument, signEventDocumentUrl,
  getCurrentPolicyVersion, recordPolicyAgreement, listMyPolicyAgreements,
} from "@/lib/host.functions";
import { uploadEventDocument } from "@/lib/eventDocumentUpload";
import { DocumentPreviewDialog } from "@/components/DocumentPreviewDialog";
import { isDocumentStale } from "@/lib/complianceStale";

type DocType = "permit" | "insurance" | "capacity" | "other";

const REQUIRED: { type: DocType; label: string; hint: string }[] = [
  { type: "permit", label: "Event permit", hint: "Event / liquor / noise permit issued by the city" },
  { type: "insurance", label: "Insurance certificate", hint: "Liability insurance certificate covering this event" },
  { type: "capacity", label: "Capacity certificate", hint: "Venue occupancy certificate showing legal max" },
];

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.heic";
const MAX_BYTES = 20 * 1024 * 1024;

export function EventDocumentsSection({ eventId }: { eventId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listEventDocuments);
  const registerFn = useServerFn(registerEventDocument);
  const deleteFn = useServerFn(deleteEventDocument);
  const signFn = useServerFn(signEventDocumentUrl);
  const policyFn = useServerFn(getCurrentPolicyVersion);
  const recordAgreementFn = useServerFn(recordPolicyAgreement);
  const listAgreementsFn = useServerFn(listMyPolicyAgreements);

  const q = useQuery({
    queryKey: ["event-documents", eventId],
    queryFn: () => listFn({ data: { event_id: eventId } }),
  });

  const policy = useQuery({
    queryKey: ["compliance-policy-current"],
    queryFn: () => policyFn(),
  });

  const agreements = useQuery({
    queryKey: ["my-policy-agreements", eventId],
    queryFn: () => listAgreementsFn({ data: { event_id: eventId } }),
  });

  const currentVersionId = policy.data?.id ?? null;
  const existingAgreement =
    currentVersionId && agreements.data
      ? agreements.data.find((a) => a.policy_version_id === currentVersionId) ?? null
      : null;
  const hasAgreedToCurrent = !!existingAgreement;

  const recordAgreement = useMutation({
    mutationFn: () =>
      recordAgreementFn({
        data: { policy_version_id: currentVersionId!, event_id: eventId },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["my-policy-agreements", eventId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not record agreement"),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Document removed"); qc.invalidateQueries({ queryKey: ["event-documents", eventId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const [uploadingType, setUploadingType] = useState<DocType | null>(null);
  const [lastRejection, setLastRejection] = useState<string | null>(null);

  async function upload(type: DocType, file: File) {
    if (!currentVersionId) {
      toast.error("Compliance policy hasn't loaded yet — try again in a moment.");
      return;
    }
    if (!hasAgreedToCurrent) {
      const msg = `You must agree to compliance policy v${policy.data?.version ?? "?"} before uploading. Check the agreement box above.`;
      setLastRejection(msg);
      toast.error(msg);
      return;
    }
    if (file.size > MAX_BYTES) { toast.error("File must be under 20 MB"); return; }
    setUploadingType(type);
    try {
      const result = await uploadEventDocument({
        supabase,
        register: registerFn,
        eventId,
        type,
        file,
        currentVersionId,
      });
      if (result.ok) {
        setLastRejection(null);
        toast.success(`Uploaded (against policy v${policy.data?.version})`);
        qc.invalidateQueries({ queryKey: ["event-documents", eventId] });
      } else {
        if (result.cleanedUp) {
          qc.invalidateQueries({ queryKey: ["my-policy-agreements", eventId] });
        }
        setLastRejection(result.error.message);
        toast.error(result.error.message, { description: "Reported by the compliance service" });
      }
    } finally {
      setUploadingType(null);
    }
  }


  const [previewTarget, setPreviewTarget] = useState<{ id: string; file_name: string; content_type?: string | null } | null>(null);
  function openDoc(doc: { id: string; file_name: string; content_type?: string | null }) {
    setPreviewTarget({ id: doc.id, file_name: doc.file_name, content_type: doc.content_type ?? null });
  }
  async function signUrlFor(id: string): Promise<string> {
    const { url } = await signFn({ data: { id } });
    return url;
  }

  const docs = q.data ?? [];
  const byType = new Map<DocType, typeof docs>();
  for (const d of docs) {
    const t = d.doc_type as DocType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(d);
  }
  const missing = REQUIRED.filter((r) => !byType.get(r.type)?.length);
  const staleDocs = policy.data
    ? docs.filter((d) =>
        isDocumentStale({
          docPolicyVersionId: d.policy_version_id,
          currentPolicyVersionId: policy.data!.id,
          reAcknowledged: hasAgreedToCurrent,
        }),
      )
    : [];

  return (
    <div className="mt-10 rounded-2xl border border-border/60 bg-card/60 p-6">
      <div className="flex items-center justify-between gap-2 mb-4">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Compliance documents</div>
        {missing.length ? (
          <span className="text-[10px] uppercase tracking-widest text-amber-400">
            {missing.length} required missing
          </span>
        ) : (
          <span className="text-[10px] uppercase tracking-widest text-emerald-400">All required uploaded</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        Upload permits, insurance, and capacity paperwork. Publishing is blocked until all three required documents are attached. PDF or image, 20 MB max.
      </p>

      <PolicyAgreementCard
        loading={policy.isLoading || agreements.isLoading}
        version={policy.data?.version ?? null}
        effectiveAt={policy.data?.effective_at ?? null}
        summary={policy.data?.summary ?? null}
        agreed={hasAgreedToCurrent}
        acceptedAt={existingAgreement?.accepted_at ?? null}
        recording={recordAgreement.isPending}
        onAgreeChange={(checked) => {
          if (checked && !hasAgreedToCurrent && currentVersionId) recordAgreement.mutate();
        }}
      />

      {staleDocs.length > 0 && (
        <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          {staleDocs.length} document{staleDocs.length === 1 ? "" : "s"} on file were uploaded under an older policy version.
          Re-upload under the current policy when convenient.
        </div>
      )}

      {!hasAgreedToCurrent && !policy.isLoading && currentVersionId && (
        <div
          role="alert"
          className="mt-3 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive-foreground"
        >
          <div className="font-semibold uppercase tracking-widest text-destructive">Uploads blocked</div>
          <p className="mt-1 text-destructive/90">
            You must agree to compliance policy v{policy.data?.version} before you can upload
            permits, insurance, or capacity documents.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-destructive px-3 py-1.5 text-xs font-semibold text-destructive-foreground shadow-sm transition hover:bg-destructive/90 focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive/60 disabled:opacity-60"
              disabled={recordAgreement.isPending}
              onClick={() => {
                const el = document.getElementById("policy-agree");
                el?.scrollIntoView({ behavior: "smooth", block: "center" });
                (el as HTMLInputElement | null)?.focus({ preventScroll: true });
              }}
            >
              Review & agree to policy v{policy.data?.version} →
            </button>
            <span className="text-[11px] text-destructive/80">
              Uploads unlock as soon as your agreement is recorded.
            </span>
          </div>
          {lastRejection && (
            <div className="mt-2 rounded border border-destructive/40 bg-background/60 p-2 text-[11px] text-destructive">
              <div className="font-semibold uppercase tracking-widest text-destructive/80">
                Server response
              </div>
              <p className="mt-1 font-mono leading-snug text-destructive/90 break-words">
                {lastRejection}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="space-y-4 mt-5">

        {REQUIRED.map((r) => (
          <DocSlot
            key={r.type} type={r.type} label={r.label} hint={r.hint} required
            docs={byType.get(r.type) ?? []}
            uploading={uploadingType === r.type}
            uploadDisabled={!hasAgreedToCurrent}
            currentPolicyId={currentVersionId}
            reAcknowledged={hasAgreedToCurrent}
            onUpload={(f) => upload(r.type, f)}
            onOpen={openDoc}
            onDelete={(id) => del.mutate(id)}
          />
        ))}
        <DocSlot
          type="other" label="Additional documents" hint="Anything else useful (fire marshal, medical, security plan)"
          docs={byType.get("other") ?? []}
          uploading={uploadingType === "other"}
          uploadDisabled={!hasAgreedToCurrent}
          currentPolicyId={currentVersionId}
          reAcknowledged={hasAgreedToCurrent}
          onUpload={(f) => upload("other", f)}
          onOpen={openDoc}
          onDelete={(id) => del.mutate(id)}
        />
      </div>
      <DocumentPreviewDialog
        target={previewTarget}
        onOpenChange={(open) => { if (!open) setPreviewTarget(null); }}
        signUrl={signUrlFor}
      />
    </div>
  );
}

function PolicyAgreementCard({
  loading, version, effectiveAt, summary, agreed, acceptedAt, recording, onAgreeChange,
}: {
  loading: boolean;
  version: string | null;
  effectiveAt: string | null;
  summary: string | null;
  agreed: boolean;
  acceptedAt: string | null;
  recording: boolean;
  onAgreeChange: (checked: boolean) => void;
}) {
  if (loading) {
    return <div className="rounded-lg border border-border/60 p-4 text-xs text-muted-foreground">Loading policy version…</div>;
  }
  if (!version) {
    return <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-xs text-destructive">No active compliance policy found.</div>;
  }
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-[0.3em] text-primary">
          Compliance policy v{version}
        </div>
        {effectiveAt && (
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Effective {new Date(effectiveAt).toLocaleDateString()}
          </div>
        )}
      </div>
      {summary && <p className="mt-2 text-xs text-muted-foreground">{summary}</p>}
      <div className="mt-3 flex items-start gap-2">
        <input
          id="policy-agree"
          type="checkbox"
          checked={agreed}
          disabled={agreed || recording}
          onChange={(e) => onAgreeChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-primary disabled:opacity-70"
        />
        <label htmlFor="policy-agree" className="text-xs text-foreground">
          I have read and agree to the current{" "}
          <Link to="/compliance" target="_blank" className="text-primary underline underline-offset-2">
            compliance policy (v{version})
          </Link>{" "}
          for every document I upload against this event.
        </label>
      </div>
      {agreed && acceptedAt && (
        <div className="mt-2 text-[11px] text-emerald-400">
          Agreement recorded {new Date(acceptedAt).toLocaleString()}. Your acceptance is stored with your account.
        </div>
      )}
      {recording && (
        <div className="mt-2 text-[11px] text-muted-foreground">Recording agreement…</div>
      )}
    </div>
  );
}

function DocSlot({
  type, label, hint, required, docs, uploading, uploadDisabled, currentPolicyId, onUpload, onOpen, onDelete,
}: {
  type: DocType; label: string; hint: string; required?: boolean;
  docs: {
    id: string; file_name: string; size_bytes: number | null; uploaded_at: string;
    content_type?: string | null;
    policy_version_id?: string | null; policy_version_label?: string | null;
  }[];
  uploading: boolean;
  uploadDisabled: boolean;
  currentPolicyId: string | null;
  onUpload: (file: File) => void;
  onOpen: (doc: { id: string; file_name: string; content_type?: string | null }) => void;
  onDelete: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const has = docs.length > 0;
  return (
    <div className="rounded-lg border border-border/60 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium flex items-center gap-2">
            {label}
            {required && (
              <span className={`text-[9px] uppercase tracking-widest px-1.5 py-0.5 rounded ${
                has ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
              }`}>
                {has ? "on file" : "required"}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>
        </div>
        <div className="shrink-0">
          <input
            ref={inputRef} type="file" accept={ACCEPT} className="sr-only"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); e.currentTarget.value = ""; }}
          />
          <button
            type="button" disabled={uploading || uploadDisabled}
            onClick={() => inputRef.current?.click()}
            title={uploadDisabled ? "Agree to the current policy version to upload" : undefined}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest hover:bg-secondary/50 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? "Uploading…" : has ? "Replace / add" : "Upload"}
          </button>
        </div>
      </div>

      {has && (
        <ul className="mt-3 divide-y divide-border/50">
          {docs.map((d) => {
            const stale = d.policy_version_id && currentPolicyId && d.policy_version_id !== currentPolicyId;
            return (
              <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                <button
                  type="button" onClick={() => onOpen(d)}
                  className="min-w-0 text-left text-foreground hover:text-primary truncate"
                  title={d.file_name}
                >
                  {d.file_name}
                </button>
                <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
                  {d.policy_version_label ? (
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                        stale ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"
                      }`}
                      title={stale ? "Uploaded under an older policy version" : "Current policy version"}
                    >
                      policy v{d.policy_version_label}
                    </span>
                  ) : (
                    <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest">unversioned</span>
                  )}
                  <span>{formatSize(d.size_bytes)}</span>
                  <span>{new Date(d.uploaded_at).toLocaleDateString()}</span>
                  <button
                    type="button"
                    onClick={() => { if (confirm(`Remove ${d.file_name}?`)) onDelete(d.id); }}
                    className="rounded-md border border-destructive/50 px-2 py-0.5 text-[10px] uppercase tracking-widest text-destructive hover:bg-destructive/20"
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatSize(n: number | null) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
