import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  listEventDocuments, registerEventDocument, deleteEventDocument, signEventDocumentUrl,
} from "@/lib/host.functions";

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

  const q = useQuery({
    queryKey: ["event-documents", eventId],
    queryFn: () => listFn({ data: { event_id: eventId } }),
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Document removed"); qc.invalidateQueries({ queryKey: ["event-documents", eventId] }); },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Delete failed"),
  });

  const [uploadingType, setUploadingType] = useState<DocType | null>(null);

  async function upload(type: DocType, file: File) {
    if (file.size > MAX_BYTES) { toast.error("File must be under 20 MB"); return; }
    setUploadingType(type);
    try {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
      const key = `${eventId}/${type}-${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("event-documents").upload(key, file, { contentType: file.type || undefined, upsert: false });
      if (upErr) throw upErr;
      await registerFn({
        data: {
          event_id: eventId,
          doc_type: type,
          file_path: key,
          file_name: file.name.slice(0, 200),
          content_type: file.type || undefined,
          size_bytes: file.size,
        },
      });
      toast.success("Uploaded");
      qc.invalidateQueries({ queryKey: ["event-documents", eventId] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadingType(null);
    }
  }

  async function openDoc(id: string) {
    try {
      const { url } = await signFn({ data: { id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Cannot open");
    }
  }

  const docs = q.data ?? [];
  const byType = new Map<DocType, typeof docs>();
  for (const d of docs) {
    const t = d.doc_type as DocType;
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t)!.push(d);
  }
  const missing = REQUIRED.filter((r) => !byType.get(r.type)?.length);

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
      <p className="text-xs text-muted-foreground mb-5">
        Upload permits, insurance, and capacity paperwork. Publishing is blocked until all three required documents are attached. PDF or image, 20 MB max.
      </p>

      <div className="space-y-4">
        {REQUIRED.map((r) => (
          <DocSlot
            key={r.type} type={r.type} label={r.label} hint={r.hint} required
            docs={byType.get(r.type) ?? []}
            uploading={uploadingType === r.type}
            onUpload={(f) => upload(r.type, f)}
            onOpen={openDoc}
            onDelete={(id) => del.mutate(id)}
          />
        ))}
        <DocSlot
          type="other" label="Additional documents" hint="Anything else useful (fire marshal, medical, security plan)"
          docs={byType.get("other") ?? []}
          uploading={uploadingType === "other"}
          onUpload={(f) => upload("other", f)}
          onOpen={openDoc}
          onDelete={(id) => del.mutate(id)}
        />
      </div>
    </div>
  );
}

function DocSlot({
  type, label, hint, required, docs, uploading, onUpload, onOpen, onDelete,
}: {
  type: DocType; label: string; hint: string; required?: boolean;
  docs: { id: string; file_name: string; size_bytes: number | null; uploaded_at: string }[];
  uploading: boolean;
  onUpload: (file: File) => void;
  onOpen: (id: string) => void;
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
            type="button" disabled={uploading}
            onClick={() => inputRef.current?.click()}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest hover:bg-secondary/50 disabled:opacity-50"
          >
            {uploading ? "Uploading…" : has ? "Replace / add" : "Upload"}
          </button>
        </div>
      </div>

      {has && (
        <ul className="mt-3 divide-y divide-border/50">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-3 py-2 text-xs">
              <button
                type="button" onClick={() => onOpen(d.id)}
                className="min-w-0 text-left text-foreground hover:text-primary truncate"
                title={d.file_name}
              >
                {d.file_name}
              </button>
              <div className="flex items-center gap-3 shrink-0 text-muted-foreground">
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
          ))}
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
