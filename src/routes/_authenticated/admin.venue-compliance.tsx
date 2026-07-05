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
import {
  VENUE_COMPLIANCE_ACCEPT_ATTR,
  VENUE_COMPLIANCE_FILE_HELP,
  validateComplianceFile,
  validateExpiryDate,
} from "@/lib/venue-compliance-validation";

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
      if (!file) throw new Error("Choose a file first.");
      const fileCheck = validateComplianceFile({
        name: file.name,
        size: file.size,
        type: file.type,
      });
      if (!fileCheck.ok) throw new Error(fileCheck.error);
      const expiryCheck = validateExpiryDate(form.expires_on || null);
      if (!expiryCheck.ok) throw new Error(expiryCheck.error);
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
      const expiryCheck = validateExpiryDate(editForm.expires_on || null);
      if (!expiryCheck.ok) throw new Error(expiryCheck.error);
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
      qc.invalidateQueries({ queryKey: ["admin-venue-compliance-audit"] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not generate PDF"),
  });

  function startEdit(r: any) {
    setEditingId(r.id);
    setEditForm({
      kind: r.kind,
      title: r.title ?? "",
      issuer: r.issuer ?? "",
      reference_number: r.reference_number ?? "",
      issued_on: r.issued_on ?? "",
      expires_on: r.expires_on ?? "",
      notes: r.notes ?? "",
    });
  }

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
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) =>
                  setForm({ ...form, expires_on: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
                aria-invalid={
                  form.expires_on &&
                  !validateExpiryDate(form.expires_on).ok
                    ? true
                    : undefined
                }
              />
              {form.expires_on && !validateExpiryDate(form.expires_on).ok && (
                <p className="text-xs text-destructive">
                  {(validateExpiryDate(form.expires_on) as { error: string }).error}
                </p>
              )}
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
                File · {VENUE_COMPLIANCE_FILE_HELP}
              </span>
              <input
                type="file"
                required
                accept={VENUE_COMPLIANCE_ACCEPT_ATTR}
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  if (f) {
                    const check = validateComplianceFile({
                      name: f.name,
                      size: f.size,
                      type: f.type,
                    });
                    if (!check.ok) {
                      toast.error(check.error);
                      e.target.value = "";
                      setFile(null);
                      return;
                    }
                  }
                  setFile(f);
                }}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
              {file && (
                <p className="text-xs text-muted-foreground">
                  Selected: {file.name} · {(file.size / (1024 * 1024)).toFixed(2)} MB
                </p>
              )}
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
                          onClick={() =>
                            editingId === r.id ? setEditingId(null) : startEdit(r)
                          }
                          className="text-muted-foreground hover:text-foreground"
                        >
                          {editingId === r.id ? "Cancel" : "Edit"}
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

                    {editingId === r.id && (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          updateMut.mutate();
                        }}
                        className="mt-3 rounded-lg border border-border bg-background/50 p-4 space-y-3"
                      >
                        <div className="grid gap-3 md:grid-cols-2">
                          <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Type</span>
                            <select
                              value={editForm.kind}
                              onChange={(e) =>
                                setEditForm({ ...editForm, kind: e.target.value as Kind })
                              }
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            >
                              {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
                                <option key={k} value={k}>
                                  {KIND_LABEL[k]}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Title</span>
                            <input
                              required
                              value={editForm.title}
                              onChange={(e) =>
                                setEditForm({ ...editForm, title: e.target.value })
                              }
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Issuer</span>
                            <input
                              value={editForm.issuer}
                              onChange={(e) =>
                                setEditForm({ ...editForm, issuer: e.target.value })
                              }
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Reference</span>
                            <input
                              value={editForm.reference_number}
                              onChange={(e) =>
                                setEditForm({
                                  ...editForm,
                                  reference_number: e.target.value,
                                })
                              }
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Issued on</span>
                            <input
                              type="date"
                              value={editForm.issued_on}
                              onChange={(e) =>
                                setEditForm({ ...editForm, issued_on: e.target.value })
                              }
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            />
                          </label>
                          <label className="space-y-1 text-xs">
                            <span className="text-muted-foreground">Expires on</span>
                            <input
                              type="date"
                              value={editForm.expires_on}
                              onChange={(e) =>
                                setEditForm({ ...editForm, expires_on: e.target.value })
                              }
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            />
                            {editForm.expires_on &&
                              !validateExpiryDate(editForm.expires_on).ok && (
                                <p className="text-xs text-destructive">
                                  {(validateExpiryDate(editForm.expires_on) as { error: string }).error}
                                </p>
                              )}
                          </label>
                          <label className="space-y-1 text-xs md:col-span-2">
                            <span className="text-muted-foreground">Notes</span>
                            <textarea
                              rows={2}
                              value={editForm.notes}
                              onChange={(e) =>
                                setEditForm({ ...editForm, notes: e.target.value })
                              }
                              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            />
                          </label>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setEditingId(null)}
                            className="rounded-md border border-border px-3 py-1.5 text-xs"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            disabled={updateMut.isPending}
                            className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                          >
                            {updateMut.isPending ? "Saving…" : "Save changes"}
                          </button>
                        </div>
                      </form>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      {/* Audit trail */}
      <section className="mx-auto max-w-5xl px-5 pb-16">
        <h2 className="mb-4 font-display text-lg font-semibold">
          Audit trail{" "}
          <span className="text-sm font-normal text-muted-foreground">
            (last 200 events)
          </span>
        </h2>
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {auditQuery.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : auditQuery.error ? (
            <div className="p-6 text-sm text-destructive">
              {(auditQuery.error as Error).message}
            </div>
          ) : (auditQuery.data?.rows ?? []).length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No activity recorded yet.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(auditQuery.data?.rows ?? []).map((entry: any) => {
                const when = new Date(entry.created_at).toLocaleString();
                const actor =
                  entry.actor_name ||
                  entry.actor_email ||
                  entry.actor_id.slice(0, 8);
                const changed =
                  entry.action === "updated" && entry.details?.changes
                    ? Object.keys(entry.details.changes)
                    : [];
                return (
                  <li key={entry.id} className="p-4 space-y-1 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span
                          className={`text-xs font-semibold uppercase tracking-widest ${
                            ACTION_COLOR[entry.action] ?? "text-foreground"
                          }`}
                        >
                          {ACTION_LABEL[entry.action] ?? entry.action}
                        </span>
                        {entry.document_title && (
                          <span className="text-sm">{entry.document_title}</span>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground">{when}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      by <span className="text-foreground">{actor}</span>
                      {entry.actor_email && entry.actor_name && (
                        <span> · {entry.actor_email}</span>
                      )}
                    </div>
                    {entry.action === "summary_generated" && (
                      <div className="text-xs text-muted-foreground">
                        {[
                          entry.details?.recipient &&
                            `Recipient: ${entry.details.recipient}`,
                          entry.details?.venue_name &&
                            `Venue: ${entry.details.venue_name}`,
                          entry.details?.event_date &&
                            `Date: ${entry.details.event_date}`,
                          typeof entry.details?.document_count === "number" &&
                            `${entry.details.document_count} documents`,
                        ]
                          .filter(Boolean)
                          .join("  ·  ")}
                      </div>
                    )}
                    {changed.length > 0 && (
                      <div className="text-xs text-muted-foreground">
                        Changed: {changed.join(", ")}
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
