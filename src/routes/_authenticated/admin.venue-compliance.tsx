import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  listVenueComplianceDocs,
  uploadVenueComplianceDoc,
  updateVenueComplianceDoc,
  deleteVenueComplianceDoc,
  getVenueComplianceDownloadUrl,
  generateComplianceSummaryPdf,
  listVenueComplianceAudit,
} from "@/lib/venue-compliance.functions";

const ACTION_LABEL: Record<string, string> = {
  uploaded: "Uploaded",
  updated: "Updated",
  deleted: "Deleted",
  summary_generated: "Generated summary PDF",
};

const ACTION_COLOR: Record<string, string> = {
  uploaded: "text-emerald-500",
  updated: "text-amber-500",
  deleted: "text-destructive",
  summary_generated: "text-primary",
};

export const Route = createFileRoute("/_authenticated/admin/venue-compliance")({
  head: () => ({
    meta: [
      { title: "Venue compliance — Admin" },
      {
        name: "description",
        content:
          "Manage public liability insurance, event permits, and generate a compliance summary PDF for venue owners.",
      },
    ],
  }),
  component: AdminVenueCompliancePage,
});

type Kind = "public_liability_insurance" | "event_permit" | "other";

const KIND_LABEL: Record<Kind, string> = {
  public_liability_insurance: "Public liability insurance",
  event_permit: "Event permit",
  other: "Other",
};

const emptyForm = {
  kind: "public_liability_insurance" as Kind,
  title: "",
  issuer: "",
  reference_number: "",
  issued_on: "",
  expires_on: "",
  notes: "",
};

async function fileToBase64(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(bin);
}

function AdminVenueCompliancePage() {
  const [form, setForm] = useState(emptyForm);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState({
    venue_name: "",
    event_date: "",
    recipient: "",
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState(emptyForm);

  const listFn = useServerFn(listVenueComplianceDocs);
  const uploadFn = useServerFn(uploadVenueComplianceDoc);
  const updateFn = useServerFn(updateVenueComplianceDoc);
  const deleteFn = useServerFn(deleteVenueComplianceDoc);
  const dlFn = useServerFn(getVenueComplianceDownloadUrl);
  const pdfFn = useServerFn(generateComplianceSummaryPdf);
  const auditFn = useServerFn(listVenueComplianceAudit);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["admin-venue-compliance"],
    queryFn: () => listFn(),
  });

  const auditQuery = useQuery({
    queryKey: ["admin-venue-compliance-audit"],
    queryFn: () => auditFn(),
  });

  function invalidateAll() {
    qc.invalidateQueries({ queryKey: ["admin-venue-compliance"] });
    qc.invalidateQueries({ queryKey: ["admin-venue-compliance-audit"] });
  }

  const uploadMut = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error("Choose a file first");
      if (file.size > 20 * 1024 * 1024) throw new Error("File exceeds 20MB");
      const file_base64 = await fileToBase64(file);
      return uploadFn({
        data: {
          ...form,
          issuer: form.issuer || null,
          reference_number: form.reference_number || null,
          issued_on: form.issued_on || null,
          expires_on: form.expires_on || null,
          notes: form.notes || null,
          file_name: file.name,
          file_mime_type: file.type || null,
          file_size: file.size,
          file_base64,
        },
      });
    },
    onSuccess: () => {
      setForm(emptyForm);
      setFile(null);
      toast.success("Compliance document uploaded");
      invalidateAll();
    },
    onError: (e: any) =>
      toast.error(e?.message ?? "Failed to upload document"),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      if (!editingId) throw new Error("Nothing to update");
      return updateFn({
        data: {
          id: editingId,
          kind: editForm.kind,
          title: editForm.title,
          issuer: editForm.issuer || null,
          reference_number: editForm.reference_number || null,
          issued_on: editForm.issued_on || null,
          expires_on: editForm.expires_on || null,
          notes: editForm.notes || null,
        },
      });
    },
    onSuccess: () => {
      setEditingId(null);
      toast.success("Document updated");
      invalidateAll();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update document"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Document deleted");
      invalidateAll();
    },
  });

  const pdfMut = useMutation({
    mutationFn: () => pdfFn({ data: summary }),
    onSuccess: ({ base64, filename, contentType }) => {
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const url = URL.createObjectURL(new Blob([bytes], { type: contentType }));
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5_000);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not generate PDF"),
  });

  async function openDoc(id: string) {
    try {
      const { url } = await dlFn({ data: { id } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not open document");
    }
  }

  const rows = query.data?.rows ?? [];
  const today = new Date();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">
          Admin
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold">
          Venue compliance
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Store your insurance certificate and event permits, and export a
          compliance summary PDF to share with venue owners.
        </p>
      </header>

      {/* Upload form */}
      <section className="mx-auto max-w-5xl px-5 pb-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            uploadMut.mutate();
          }}
          className="rounded-2xl border border-border bg-card p-6 space-y-4"
        >
          <h2 className="font-display text-lg font-semibold">Upload document</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Type</span>
              <select
                required
                value={form.kind}
                onChange={(e) =>
                  setForm({ ...form, kind: e.target.value as Kind })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              >
                {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Title</span>
              <input
                required
                maxLength={200}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Public Liability Insurance 2026"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Issuer</span>
              <input
                maxLength={200}
                value={form.issuer}
                onChange={(e) => setForm({ ...form, issuer: e.target.value })}
                placeholder="Insurer / permit authority"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Reference / policy no.</span>
              <input
                maxLength={200}
                value={form.reference_number}
                onChange={(e) =>
                  setForm({ ...form, reference_number: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Issued on</span>
              <input
                type="date"
                value={form.issued_on}
                onChange={(e) => setForm({ ...form, issued_on: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Expires on</span>
              <input
                type="date"
                value={form.expires_on}
                onChange={(e) =>
                  setForm({ ...form, expires_on: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Notes</span>
              <textarea
                rows={2}
                maxLength={4000}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">
                File (PDF or image, max 20MB)
              </span>
              <input
                type="file"
                required
                accept="application/pdf,image/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={uploadMut.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {uploadMut.isPending ? "Uploading…" : "Upload"}
            </button>
          </div>
        </form>
      </section>

      {/* Summary PDF */}
      <section className="mx-auto max-w-5xl px-5 pb-8">
        <div className="rounded-2xl border border-neon/40 bg-neon/5 p-6 space-y-4">
          <h2 className="font-display text-lg font-semibold">
            Compliance summary PDF
          </h2>
          <p className="text-sm text-muted-foreground">
            Generate a shareable summary of all current documents to send to a
            venue owner.
          </p>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Venue name</span>
              <input
                maxLength={200}
                value={summary.venue_name}
                onChange={(e) =>
                  setSummary({ ...summary, venue_name: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Proposed date</span>
              <input
                maxLength={200}
                value={summary.event_date}
                onChange={(e) =>
                  setSummary({ ...summary, event_date: e.target.value })
                }
                placeholder="e.g. Sat 14 Nov 2026"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Recipient</span>
              <input
                maxLength={200}
                value={summary.recipient}
                onChange={(e) =>
                  setSummary({ ...summary, recipient: e.target.value })
                }
                placeholder="Venue owner / contact"
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => pdfMut.mutate()}
              disabled={pdfMut.isPending}
              className="rounded-md bg-neon px-4 py-2 text-sm font-medium text-background disabled:opacity-50"
            >
              {pdfMut.isPending ? "Generating…" : "Generate summary PDF"}
            </button>
          </div>
        </div>
      </section>

      {/* Documents list */}
      <section className="mx-auto max-w-5xl px-5 pb-16">
        <h2 className="mb-4 font-display text-lg font-semibold">
          On file{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({rows.length})
          </span>
        </h2>
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {query.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : query.error ? (
            <div className="p-6 text-sm text-destructive">
              {(query.error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No documents uploaded yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r: any) => {
                const expired =
                  r.expires_on && new Date(r.expires_on).getTime() < today.getTime();
                return (
                  <li key={r.id} className="p-5 space-y-1.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="text-sm font-medium">{r.title}</div>
                      <div className="flex items-center gap-3 text-xs">
                        <button
                          type="button"
                          onClick={() => openDoc(r.id)}
                          className="text-primary hover:underline"
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("Delete this document?"))
                              deleteMut.mutate(r.id);
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      {KIND_LABEL[r.kind as Kind] ?? r.kind}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {[
                        r.issuer && `Issuer: ${r.issuer}`,
                        r.reference_number && `Ref: ${r.reference_number}`,
                        r.issued_on && `Issued: ${r.issued_on}`,
                        r.expires_on &&
                          `${expired ? "⚠ Expired" : "Expires"}: ${r.expires_on}`,
                      ]
                        .filter(Boolean)
                        .join("  ·  ")}
                    </div>
                    {r.notes && (
                      <div className="text-sm whitespace-pre-wrap">
                        {r.notes}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </main>
  );
}
