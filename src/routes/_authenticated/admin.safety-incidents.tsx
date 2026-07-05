import { useState, useMemo, useEffect } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listSafetyIncidents,
  createSafetyIncident,
  archiveSafetyIncident,
  restoreSafetyIncident,
  listIncidentAttachments,
  createIncidentAttachmentUploadUrl,
  recordIncidentAttachment,
  deleteIncidentAttachment,
} from "@/lib/safety-incidents.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/admin/safety-incidents")({
  head: () => ({
    meta: [
      { title: "Safety incident reports — Admin" },
      {
        name: "description",
        content:
          "Log and search safety incident reports for compliance audit trail.",
      },
    ],
  }),
  component: AdminSafetyIncidentsPage,
});

const emptyForm = {
  incident_date: new Date().toISOString().slice(0, 10),
  venue: "",
  involved_party: "",
  nature_of_incident: "",
  resolution_taken: "",
};

type View = "active" | "archived" | "all";

const ALL_COLUMNS: { key: string; label: string }[] = [
  { key: "id", label: "ID" },
  { key: "incident_date", label: "Incident date" },
  { key: "venue", label: "Venue" },
  { key: "involved_party", label: "Involved party" },
  { key: "nature_of_incident", label: "Nature of incident" },
  { key: "resolution_taken", label: "Resolution taken" },
  { key: "created_at", label: "Created at" },
  { key: "created_by", label: "Created by" },
  { key: "archived_at", label: "Archived at" },
  { key: "archived_by", label: "Archived by" },
  { key: "archive_reason", label: "Archive reason" },
];
const DEFAULT_EXPORT_COLS = ALL_COLUMNS.map((c) => c.key);
const EXPORT_COLS_STORAGE_KEY = "admin-safety-incidents-export-cols-v1";

function AdminSafetyIncidentsPage() {
  const [search, setSearch] = useState("");
  const [view, setView] = useState<View>("active");
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const [exportCols, setExportCols] = useState<string[]>(DEFAULT_EXPORT_COLS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXPORT_COLS_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (k: unknown): k is string =>
            typeof k === "string" && ALL_COLUMNS.some((c) => c.key === k),
        );
        if (valid.length > 0) setExportCols(valid);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(EXPORT_COLS_STORAGE_KEY, JSON.stringify(exportCols));
    } catch {
      /* ignore */
    }
  }, [exportCols]);


  const listFn = useServerFn(listSafetyIncidents);
  const createFn = useServerFn(createSafetyIncident);
  const archiveFn = useServerFn(archiveSafetyIncident);
  const restoreFn = useServerFn(restoreSafetyIncident);
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: ["admin-safety-incidents", search, view],
    queryFn: () =>
      listFn({
        data: {
          search,
          limit: 200,
          include_archived: view === "all",
          only_archived: view === "archived",
        },
      }),
  });

  const createMut = useMutation({
    mutationFn: (data: typeof emptyForm) => createFn({ data }),
    onSuccess: () => {
      setForm(emptyForm);
      setError(null);
      qc.invalidateQueries({ queryKey: ["admin-safety-incidents"] });
    },
    onError: (e: any) => setError(e?.message ?? "Failed to create incident"),
  });

  const archiveMut = useMutation({
    mutationFn: (v: { id: string; reason: string }) => archiveFn({ data: v }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin-safety-incidents"] }),
  });

  const restoreMut = useMutation({
    mutationFn: (id: string) => restoreFn({ data: { id } }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["admin-safety-incidents"] }),
  });

  const rows = query.data?.rows ?? [];
  const total = useMemo(() => rows.length, [rows]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    createMut.mutate(form);
  }

  function exportCsv() {
    const headers = exportCols.length > 0 ? exportCols : DEFAULT_EXPORT_COLS;
    const escape = (v: unknown) => {
      if (v === null || v === undefined) return "";
      const s = String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map((h) => {
      const label = ALL_COLUMNS.find((c) => c.key === h)?.label ?? h;
      return escape(label);
    }).join(",")];
    for (const r of rows as any[]) {
      lines.push(headers.map((h) => escape(r[h])).join(","));
    }

    // Prepend BOM for Excel compatibility
    const blob = new Blob(["\ufeff" + lines.join("\r\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    a.href = url;
    a.download = `safety-incidents-${view}-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

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
          Safety incident reports
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Log incidents and maintain a searchable compliance audit trail.
          Records are immutable — archive with a reason instead of deleting.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-10">
        <form
          onSubmit={submit}
          className="rounded-2xl border border-border bg-card p-6 space-y-4"
        >
          <h2 className="font-display text-lg font-semibold">New incident</h2>
          <div className="grid gap-4 md:grid-cols-2">
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Date</span>
              <input
                type="date"
                required
                value={form.incident_date}
                onChange={(e) =>
                  setForm({ ...form, incident_date: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-muted-foreground">Venue</span>
              <input
                type="text"
                required
                maxLength={200}
                value={form.venue}
                onChange={(e) => setForm({ ...form, venue: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Involved party</span>
              <input
                type="text"
                required
                maxLength={300}
                value={form.involved_party}
                onChange={(e) =>
                  setForm({ ...form, involved_party: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Nature of incident</span>
              <textarea
                required
                maxLength={4000}
                rows={3}
                value={form.nature_of_incident}
                onChange={(e) =>
                  setForm({ ...form, nature_of_incident: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
            <label className="space-y-1 text-sm md:col-span-2">
              <span className="text-muted-foreground">Resolution taken</span>
              <textarea
                required
                maxLength={4000}
                rows={3}
                value={form.resolution_taken}
                onChange={(e) =>
                  setForm({ ...form, resolution_taken: e.target.value })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2"
              />
            </label>
          </div>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={createMut.isPending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
            >
              {createMut.isPending ? "Saving…" : "Log incident"}
            </button>
          </div>
        </form>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-lg font-semibold">
              Audit trail{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({total})
              </span>
            </h2>
            <div className="inline-flex overflow-hidden rounded-md border border-border text-xs">
              {(["active", "archived", "all"] as View[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  className={`px-3 py-1.5 capitalize ${
                    view === v
                      ? "bg-primary text-primary-foreground"
                      : "bg-background text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <input
              type="search"
              placeholder="Search venue, party, nature, resolution…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm sm:w-80"
            />
            <button
              type="button"
              onClick={exportCsv}
              disabled={rows.length === 0}
              className="rounded-md border border-border bg-background px-3 py-2 text-xs font-medium uppercase tracking-widest text-foreground hover:bg-muted disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          {query.isLoading ? (
            <div className="p-6 text-sm text-muted-foreground">Loading…</div>
          ) : query.error ? (
            <div className="p-6 text-sm text-destructive">
              {(query.error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              No incidents found.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((r: any) => {
                const archived = !!r.archived_at;
                return (
                  <li
                    key={r.id}
                    className={`p-5 space-y-2 ${archived ? "bg-muted/30" : ""}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <div className="text-sm font-medium">
                          {r.incident_date} · {r.venue}
                        </div>
                        {archived && (
                          <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                            Archived
                          </span>
                        )}
                      </div>
                      {archived ? (
                        <button
                          type="button"
                          onClick={() => {
                            if (confirm("Restore this record to active?"))
                              restoreMut.mutate(r.id);
                          }}
                          className="text-xs text-muted-foreground hover:text-foreground"
                        >
                          Restore
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            const reason = prompt(
                              "Archive reason (recorded in audit trail):",
                            );
                            if (reason && reason.trim().length >= 3) {
                              archiveMut.mutate({
                                id: r.id,
                                reason: reason.trim(),
                              });
                            } else if (reason !== null) {
                              alert("Reason must be at least 3 characters.");
                            }
                          }}
                          className="text-xs text-muted-foreground hover:text-destructive"
                        >
                          Archive
                        </button>
                      )}
                    </div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      Involved
                    </div>
                    <div className="text-sm">{r.involved_party}</div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      Nature
                    </div>
                    <div className="text-sm whitespace-pre-wrap">
                      {r.nature_of_incident}
                    </div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      Resolution
                    </div>
                    <div className="text-sm whitespace-pre-wrap">
                      {r.resolution_taken}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Logged {new Date(r.created_at).toLocaleString()}
                    </div>
                    {archived && (
                      <div className="mt-2 rounded-md border border-border bg-background p-3 text-xs">
                        <div className="uppercase tracking-widest text-muted-foreground">
                          Archived {new Date(r.archived_at).toLocaleString()}
                        </div>
                        {r.archive_reason && (
                          <div className="mt-1 whitespace-pre-wrap">
                            {r.archive_reason}
                          </div>
                        )}
                      </div>
                    )}
                    <IncidentAttachments
                      incidentId={r.id}
                      count={r.attachment_count ?? 0}
                      canModify={!archived}
                    />
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

function IncidentAttachments({
  incidentId,
  count,
  canModify,
}: {
  incidentId: string;
  count: number;
  canModify: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [description, setDescription] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const listFn = useServerFn(listIncidentAttachments);
  const createUploadFn = useServerFn(createIncidentAttachmentUploadUrl);
  const recordFn = useServerFn(recordIncidentAttachment);
  const deleteFn = useServerFn(deleteIncidentAttachment);
  const qc = useQueryClient();

  const q = useQuery({
    queryKey: ["incident-attachments", incidentId],
    queryFn: () => listFn({ data: { incident_id: incidentId } }),
    enabled: open,
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["incident-attachments", incidentId] });
      qc.invalidateQueries({ queryKey: ["admin-safety-incidents"] });
    },
  });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setUploadError(null);
    setUploading(true);
    try {
      if (file.size > 20 * 1024 * 1024) {
        throw new Error("File too large (max 20 MB)");
      }
      const { file_path, token } = await createUploadFn({
        data: { incident_id: incidentId, file_name: file.name },
      });
      const { error: upErr } = await supabase.storage
        .from("safety-incident-attachments")
        .uploadToSignedUrl(file_path, token, file, {
          contentType: file.type || undefined,
        });
      if (upErr) throw upErr;
      await recordFn({
        data: {
          incident_id: incidentId,
          file_path,
          file_name: file.name,
          mime_type: file.type || null,
          size_bytes: file.size,
          description: description.trim() || null,
        },
      });
      setFile(null);
      setDescription("");
      qc.invalidateQueries({ queryKey: ["incident-attachments", incidentId] });
      qc.invalidateQueries({ queryKey: ["admin-safety-incidents"] });
    } catch (err: any) {
      setUploadError(err?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const rows = q.data?.rows ?? [];

  return (
    <div className="mt-3 rounded-md border border-border bg-background">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
      >
        <span>Attachments ({count})</span>
        <span>{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <div className="border-t border-border p-3 space-y-3">
          {q.isLoading ? (
            <div className="text-xs text-muted-foreground">Loading…</div>
          ) : q.error ? (
            <div className="text-xs text-destructive">
              {(q.error as Error).message}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-xs text-muted-foreground">No attachments.</div>
          ) : (
            <ul className="space-y-2">
              {rows.map((a: any) => (
                <li
                  key={a.id}
                  className="flex flex-wrap items-start justify-between gap-2 rounded border border-border bg-card px-3 py-2 text-xs"
                >
                  <div className="min-w-0 flex-1">
                    {a.signed_url ? (
                      <a
                        href={a.signed_url}
                        target="_blank"
                        rel="noreferrer"
                        className="font-medium text-primary hover:underline break-all"
                      >
                        {a.file_name}
                      </a>
                    ) : (
                      <span className="font-medium break-all">{a.file_name}</span>
                    )}
                    <div className="mt-0.5 text-muted-foreground">
                      {a.mime_type || "file"}
                      {a.size_bytes != null &&
                        ` · ${(a.size_bytes / 1024).toFixed(1)} KB`}
                      {" · "}
                      {new Date(a.created_at).toLocaleString()}
                    </div>
                    {a.description && (
                      <div className="mt-1 whitespace-pre-wrap">
                        {a.description}
                      </div>
                    )}
                  </div>
                  {canModify && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Remove "${a.file_name}"?`))
                          del.mutate(a.id);
                      }}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
          {canModify && (
            <form onSubmit={handleUpload} className="space-y-2 border-t border-border pt-3">
              <input
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                className="block w-full text-xs"
              />
              <input
                type="text"
                placeholder="Description (searchable, optional)"
                maxLength={1000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              />
              {uploadError && (
                <div className="text-xs text-destructive">{uploadError}</div>
              )}
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!file || uploading}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Attach file"}
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

