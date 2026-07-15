import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ShieldCheck, Plus, Pencil, Trash2, X, Download } from "lucide-react";
import { toast } from "sonner";
import { RoleGuard } from "@/components/RoleGuard";
import {
  listSecurityChangelog,
  upsertSecurityChangelogEntry,
  deleteSecurityChangelogEntry,
} from "@/lib/security-changelog.functions";

export const Route = createFileRoute("/_authenticated/admin/security-changelog")({
  head: () => ({
    meta: [
      { title: "Security Changelog · Admin · AFTERDARK" },
      { name: "description", content: "Admin-only security changelog for AFTERDARK." },
    ],
  }),
  component: Page,
  errorComponent: ({ error }) => (
    <main className="mx-auto max-w-3xl p-8 text-sm text-destructive" role="alert">
      Could not load security changelog: {String((error as Error)?.message ?? error)}
    </main>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">
      No changelog entries.
    </main>
  ),
});

type Entry = {
  id: string;
  version: number;
  title: string;
  summary: string;
  published_at: string;
  created_at: string;
  updated_at: string;
};

function buildStamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function buildArtifactFilename(entry: Entry, ext: "pdf" | "md", stamp: string): string {
  const safeTitle =
    entry.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "entry";
  return `security-changelog-v${entry.version}-${safeTitle}-${stamp}.${ext}`;
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function saveBlob(bytes: BlobPart, filename: string, mime: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function saveWithChecksum(bytes: ArrayBuffer, filename: string, mime: string) {
  saveBlob(bytes, filename, mime);
  const digest = await sha256Hex(bytes);
  const checksumLine = `${digest}  ${filename}\n`;
  saveBlob(checksumLine, `${filename}.sha256`, "text/plain;charset=utf-8");
}

async function downloadEntryPdf(entry: Entry) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 56;
  const maxWidth = pageWidth - margin * 2;
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(`SECURITY CHANGELOG · VERSION ${entry.version}`, margin, y);
  y += 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.setTextColor(20);
  const titleLines = doc.splitTextToSize(entry.title, maxWidth);
  doc.text(titleLines, margin, y);
  y += titleLines.length * 24 + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(120);
  doc.text(
    `Published ${new Date(entry.published_at).toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    })}`,
    margin,
    y,
  );
  y += 24;

  doc.setDrawColor(220);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(30);
  const lineHeight = 16;
  const summaryLines = doc.splitTextToSize(entry.summary, maxWidth);
  for (const line of summaryLines) {
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }

  const bytes = doc.output("arraybuffer") as ArrayBuffer;
  const filename = buildArtifactFilename(entry, "pdf", buildStamp());
  await saveWithChecksum(bytes, filename, "application/pdf");
}

async function downloadEntryMarkdown(entry: Entry) {
  const publishedISO = new Date(entry.published_at).toISOString().slice(0, 10);
  const md =
    `# Security Changelog v${entry.version} — ${entry.title}\n\n` +
    `- Version: ${entry.version}\n` +
    `- Published: ${publishedISO}\n` +
    `- Generated: ${new Date().toISOString()}\n\n` +
    `---\n\n${entry.summary}\n`;
  const bytes = new TextEncoder().encode(md);
  const filename = buildArtifactFilename(entry, "md", buildStamp());
  await saveWithChecksum(bytes, filename, "text/markdown;charset=utf-8");
}

function Page() {
  return (
    <RoleGuard allowedRoles={["admin"]}>
      <SecurityChangelogView />
    </RoleGuard>
  );
}

function SecurityChangelogView() {
  const listFn = useServerFn(listSecurityChangelog);
  const upsertFn = useServerFn(upsertSecurityChangelogEntry);
  const deleteFn = useServerFn(deleteSecurityChangelogEntry);
  const qc = useQueryClient();

  const list = useQuery<Entry[]>({
    queryKey: ["security-changelog"],
    queryFn: () => listFn(),
  });

  const entries = useMemo(() => list.data ?? [], [list.data]);
  const latest = entries[0];
  const previous = entries.slice(1);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Partial<Entry> | null>(null);

  const selected =
    selectedId === null
      ? latest
      : entries.find((e) => e.id === selectedId) ?? latest;

  const upsert = useMutation({
    mutationFn: (input: Partial<Entry>) =>
      upsertFn({
        data: {
          id: input.id,
          version: Number(input.version),
          title: (input.title ?? "").trim(),
          summary: (input.summary ?? "").trim(),
          published_at: input.published_at,
        },
      }),
    onSuccess: () => {
      toast.success("Changelog entry saved");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["security-changelog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Entry deleted");
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ["security-changelog"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const startNew = () => {
    const nextVersion = (entries[0]?.version ?? 0) + 1;
    setEditing({
      version: nextVersion,
      title: "",
      summary: "",
    });
  };

  return (
    <section className="mx-auto max-w-6xl px-5 py-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
            Admin
          </div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Security changelog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Version-by-version summary of security-relevant changes.
          </p>
        </div>
        <button
          type="button"
          onClick={startNew}
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> New version
        </button>
      </header>

      {list.isLoading ? (
        <div className="mt-8 h-32 animate-pulse rounded-xl border border-border/60 bg-card/60" />
      ) : entries.length === 0 ? (
        <div className="mt-8 rounded-xl border border-dashed border-border/60 bg-card/40 p-8 text-center text-sm text-muted-foreground">
          No changelog entries yet. Create v1 to get started.
        </div>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
          <aside className="rounded-2xl border border-border/60 bg-card/60 p-3 lg:sticky lg:top-6 lg:self-start">
            <div className="px-3 pb-2 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Versions
            </div>
            <ul className="space-y-0.5">
              {entries.map((e, i) => {
                const active = (selected?.id ?? latest?.id) === e.id;
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(e.id)}
                      className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${
                        active
                          ? "bg-primary/15 text-primary"
                          : "text-foreground/80 hover:bg-primary/10 hover:text-primary"
                      }`}
                    >
                      <span className="truncate">
                        v{e.version}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {new Date(e.published_at).toLocaleDateString()}
                        </span>
                      </span>
                      {i === 0 && (
                        <span className="rounded bg-primary/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
                          Latest
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
            {previous.length === 0 && (
              <p className="mt-2 px-3 text-xs text-muted-foreground">
                No previous versions yet.
              </p>
            )}
          </aside>

          <div className="min-w-0">
            {selected && (
              <article className="rounded-2xl border border-border/60 bg-card p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-widest text-muted-foreground">
                      Version {selected.version} · {new Date(selected.published_at).toLocaleDateString()}
                    </div>
                    <h2 className="mt-1 font-display text-2xl font-semibold">
                      {selected.title}
                    </h2>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => downloadEntryPdf(selected)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/40"
                    >
                      <Download className="h-3.5 w-3.5" /> Download PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadEntryMarkdown(selected)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/40"
                    >
                      <Download className="h-3.5 w-3.5" /> Download MD
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(selected)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border/60 px-3 py-1.5 text-xs hover:bg-muted/40"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete v${selected.version}?`)) {
                          remove.mutate(selected.id);
                        }
                      }}
                      className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 px-3 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
                    </button>
                  </div>
                </div>
                <div className="mt-5 whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {selected.summary}
                </div>
              </article>
            )}
          </div>
        </div>
      )}

      {editing && (
        <EditorModal
          entry={editing}
          onCancel={() => setEditing(null)}
          onSave={(v) => upsert.mutate(v)}
          saving={upsert.isPending}
        />
      )}
    </section>
  );
}

function EditorModal({
  entry,
  onCancel,
  onSave,
  saving,
}: {
  entry: Partial<Entry>;
  onCancel: () => void;
  onSave: (v: Partial<Entry>) => void;
  saving: boolean;
}) {
  const [version, setVersion] = useState<number>(entry.version ?? 1);
  const [title, setTitle] = useState(entry.title ?? "");
  const [summary, setSummary] = useState(entry.summary ?? "");
  const isNew = !entry.id;

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-2xl rounded-2xl border border-border/60 bg-background p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-display text-lg">
            {isNew ? "New security version" : `Edit v${entry.version}`}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md p-1 hover:bg-muted/40"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!title.trim() || !summary.trim() || !version) return;
            onSave({ id: entry.id, version, title, summary });
          }}
        >
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Version number
            </span>
            <input
              type="number"
              min={1}
              required
              value={version}
              onChange={(e) => setVersion(Number(e.target.value))}
              className="mt-1 w-32 rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Title
            </span>
            <input
              type="text"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. RLS hardened on rewards tables"
              className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              Summary
            </span>
            <textarea
              required
              rows={8}
              maxLength={20000}
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="What changed, why it matters, any user-visible impact."
              className="mt-1 w-full rounded-md border border-border/60 bg-background px-3 py-2 text-sm"
            />
          </label>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-md border border-border/60 px-4 py-2 text-sm hover:bg-muted/40"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
            >
              {saving ? "Saving…" : isNew ? "Publish" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
