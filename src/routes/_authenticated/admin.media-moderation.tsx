import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { amIAdmin } from "@/lib/admin.functions";
import {
  adminGetModerationMediaUrl,
  adminListModerationQueue,
  adminModerateContentItem,
  adminDeleteContentItem,
  adminListModerationAudit,
  type ModerationAuditEntry,
} from "@/lib/store.functions";
import { cn } from "@/lib/utils";
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

type StatusFilter = "pending" | "approved" | "rejected" | "all";

export const Route = createFileRoute("/_authenticated/admin/media-moderation")({
  head: () => ({ meta: [{ title: "Media Moderation · Admin" }] }),
  component: AdminMediaModeration,
});

export function AdminMediaModeration() {
  const meFn = useServerFn(amIAdmin);
  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const [status, setStatus] = useState<StatusFilter>("pending");

  if (me.isLoading) return <Shell><p className="text-muted-foreground">Loading…</p></Shell>;
  if (!me.data?.isAdmin) {
    return (
      <Shell>
        <p className="text-muted-foreground">
          No admin access. <Link to="/dashboard" className="text-primary underline">Back</Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mb-6 flex flex-wrap items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs uppercase tracking-widest",
              status === s
                ? "border-primary bg-primary/20 text-primary"
                : "border-border/60 text-muted-foreground hover:border-primary/60",
            )}
          >
            {s}
          </button>
        ))}
      </div>
      <Queue status={status} onViewStatus={setStatus} />
      <RecentActivityPanel />
    </Shell>
  );
}

function Queue({
  status,
  onViewStatus,
}: {
  status: StatusFilter;
  onViewStatus: (s: StatusFilter) => void;
}) {
  const listFn = useServerFn(adminListModerationQueue);
  const q = useQuery({
    queryKey: ["admin-media-moderation", status],
    queryFn: () => listFn({ data: { status } }),
  });

  if (q.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (q.error) return <p className="text-destructive">{(q.error as Error).message}</p>;
  if (!q.data?.length) {
    return (
      <div className="rounded-2xl border border-dashed border-border/60 p-12 text-center">
        <p className="font-display text-lg">Nothing here.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {status === "pending" ? "The review queue is clear." : `No ${status} items.`}
        </p>
      </div>
    );
  }

  return (
    <ul className="space-y-6">
      {q.data.map((row) => (
        <ItemRow
          key={row.id}
          row={row as ModerationRow}
          status={status}
          onViewStatus={onViewStatus}
        />
      ))}
    </ul>
  );
}

type ModerationRow = {
  id: string;
  kind: string;
  title: string;
  description: string | null;
  cover_url: string | null;
  media_urls: Array<{ url: string; type?: string }> | null;
  creator_id: string;
  published: boolean;
  moderation_status: "pending" | "approved" | "rejected";
  moderation_notes: string | null;
  moderation_reviewed_at: string | null;
  moderation_submitted_at: string;
  created_at: string;
};

function ItemRow({
  row,
  status,
  onViewStatus,
}: {
  row: ModerationRow;
  status: StatusFilter;
  onViewStatus: (s: StatusFilter) => void;
}) {
  const qc = useQueryClient();
  const decideFn = useServerFn(adminModerateContentItem);
  const deleteFn = useServerFn(adminDeleteContentItem);
  const signFn = useServerFn(adminGetModerationMediaUrl);
  const [notes, setNotes] = useState(row.moderation_notes ?? "");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmReject, setConfirmReject] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const decide = useMutation({
    mutationFn: (decision: "approved" | "rejected" | "pending") =>
      decideFn({ data: { id: row.id, decision, notes } }),
    onSuccess: (_r, decision) => {
      qc.invalidateQueries({ queryKey: ["admin-media-moderation"] });
      qc.invalidateQueries({ queryKey: ["store-items"] });
      qc.invalidateQueries({ queryKey: ["admin-moderation-audit"] });
      // If we're already on the destination tab there's nothing to jump to.
      const viewAction =
        status === decision
          ? undefined
          : {
              label: `View in ${decision}`,
              onClick: () => onViewStatus(decision),
            };
      if (decision === "approved") {
        toast.success(`Approved: ${row.title}`, {
          description: "The item is now live on the public storefront.",
          action: viewAction,
        });
      } else if (decision === "rejected") {
        toast.success(`Rejected: ${row.title}`, {
          description: notes.trim()
            ? `Creator will see your note: “${notes.trim().slice(0, 120)}${notes.trim().length > 120 ? "…" : ""}”`
            : "Item is hidden from the storefront. Consider adding a moderator note so the creator knows why.",
          action: viewAction,
        });
      } else {
        toast.success(`Sent back to pending: ${row.title}`, {
          description: "Item is off the storefront until it's reviewed again.",
          action: viewAction,
        });
      }
    },
    onError: (e, decision) => {
      toast.error(`Couldn't mark "${row.title}" as ${decision}`, {
        description: (e as Error).message || "Please try again.",
      });
    },
  });

  const removeItem = useMutation({
    mutationFn: () => deleteFn({ data: { id: row.id } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin-media-moderation"] });
      qc.invalidateQueries({ queryKey: ["store-items"] });
      qc.invalidateQueries({ queryKey: ["admin-moderation-audit"] });
      toast.success(`Deleted: ${row.title}`, {
        description:
          "Item, its media, and any purchase records have been permanently removed.",
      });
    },
    onError: (e) => {
      toast.error(`Couldn't delete "${row.title}"`, {
        description: (e as Error).message || "Please try again.",
      });
    },
  });

  const busy = decide.isPending || removeItem.isPending;
  const pendingDecision = decide.isPending
    ? (decide.variables as "approved" | "rejected" | "pending" | undefined)
    : undefined;

  const openDelete = () => {
    if (busy) return;
    setConfirmDeleteOpen(true);
  };
  const openReject = () => {
    if (busy) return;
    setConfirmReject(true);
  };




  const openMedia = async (path: string) => {
    try {
      const { url } = await signFn({ data: { path } });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const media = row.media_urls ?? [];

  return (
    <li className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {row.kind}
            </span>
            <span
              className={cn(
                "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest",
                row.moderation_status === "approved" &&
                  "border-emerald-500/60 bg-emerald-500/15 text-emerald-400",
                row.moderation_status === "rejected" &&
                  "border-destructive/60 bg-destructive/15 text-destructive",
                row.moderation_status === "pending" &&
                  "border-amber-500/60 bg-amber-500/15 text-amber-400",
              )}
            >
              {row.moderation_status}
            </span>
          </div>
          <h3 className="mt-1 font-display text-lg">{row.title}</h3>
          {row.description && (
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{row.description}</p>
          )}
          <div className="mt-1 text-[11px] text-muted-foreground">
            Submitted {new Date(row.moderation_submitted_at).toLocaleString()}
            {row.moderation_reviewed_at && (
              <> · Reviewed {new Date(row.moderation_reviewed_at).toLocaleString()}</>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {row.cover_url && (
          <button
            type="button"
            onClick={() => openMedia(row.cover_url!)}
            className="group relative aspect-square overflow-hidden rounded-lg border border-border/60 bg-secondary/30"
            title="Open cover"
          >
            <div className="absolute left-1 top-1 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/90">
              Cover
            </div>
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              Tap to view
            </div>
          </button>
        )}
        {media.map((m, i) => (
          <button
            key={`${m.url}-${i}`}
            type="button"
            onClick={() => openMedia(m.url)}
            className="group relative aspect-square overflow-hidden rounded-lg border border-border/60 bg-secondary/30"
            title={`Open ${m.type ?? "media"}`}
          >
            <div className="absolute left-1 top-1 z-10 rounded-full bg-black/60 px-1.5 py-0.5 text-[9px] uppercase tracking-widest text-white/90">
              {m.type ?? "media"}
            </div>
            <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
              Tap to view
            </div>
          </button>
        ))}
        {!row.cover_url && media.length === 0 && (
          <p className="col-span-full text-xs text-muted-foreground">No media attached.</p>
        )}
      </div>

      <div className="mt-4">
        <label className="text-[11px] uppercase tracking-widest text-muted-foreground">
          Moderator notes
        </label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="Optional — surfaced to the creator when rejected."
          className="mt-1 w-full rounded-lg border border-border/60 bg-background/60 p-2 text-sm"
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {status !== "approved" && (
          <button
            type="button"
            onClick={() => decide.mutate("approved")}
            disabled={busy}
            aria-busy={pendingDecision === "approved"}
            className="rounded-full bg-emerald-500/20 border border-emerald-500/60 px-4 py-1.5 text-xs uppercase tracking-widest text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pendingDecision === "approved" ? "Approving…" : "Approve"}
          </button>
        )}
        {status !== "rejected" && (
          <button
            type="button"
            onClick={openReject}
            disabled={busy}
            aria-busy={pendingDecision === "rejected"}
            className="rounded-full bg-destructive/20 border border-destructive/60 px-4 py-1.5 text-xs uppercase tracking-widest text-destructive hover:bg-destructive/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pendingDecision === "rejected" ? "Rejecting…" : "Reject"}
          </button>
        )}
        {status !== "pending" && (
          <button
            type="button"
            onClick={() => decide.mutate("pending")}
            disabled={busy}
            aria-busy={pendingDecision === "pending"}
            className="rounded-full border border-border/60 px-4 py-1.5 text-xs uppercase tracking-widest text-muted-foreground hover:border-primary/60 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pendingDecision === "pending" ? "Sending back…" : "Send back to pending"}
          </button>
        )}
        <button
          type="button"
          onClick={() => setHistoryOpen((v) => !v)}
          disabled={busy}
          className="rounded-full border border-border/60 px-4 py-1.5 text-xs uppercase tracking-widest text-muted-foreground hover:border-primary/60 disabled:opacity-50 disabled:cursor-not-allowed"
          aria-expanded={historyOpen}
          aria-controls={`moderation-history-${row.id}`}
        >
          {historyOpen ? "Hide history" : "History"}
          <span className="sr-only"> for {row.title}</span>
        </button>
        <button
          type="button"
          onClick={openDelete}
          disabled={busy}
          aria-busy={removeItem.isPending}
          className="ml-auto rounded-full border border-destructive/60 px-4 py-1.5 text-xs uppercase tracking-widest text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Permanently remove this item and its media"
        >
          {removeItem.isPending ? "Deleting…" : "Delete"}
          <span className="sr-only"> {row.title}</span>
        </button>
      </div>
      {historyOpen && (
        <div id={`moderation-history-${row.id}`} className="mt-4">
          <ItemHistory contentItemId={row.id} itemTitle={row.title} />
        </div>
      )}


      <AlertDialog open={confirmReject} onOpenChange={setConfirmReject}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reject "{row.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              The item will be hidden from the storefront.{" "}
              {notes.trim()
                ? `The creator will see your note: “${notes.trim().slice(0, 160)}${notes.trim().length > 160 ? "…" : ""}”`
                : "No moderator note is attached — consider adding one so the creator knows why."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmReject(false);
                decide.mutate("rejected");
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, reject
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete "{row.title}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the item, its media, and any purchase records. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmDeleteOpen(false);
                removeItem.mutate();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Yes, delete permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}

function actionBadgeClass(action: ModerationAuditEntry["action"]): string {
  switch (action) {
    case "approved":
      return "border-emerald-500/60 bg-emerald-500/15 text-emerald-400";
    case "rejected":
      return "border-destructive/60 bg-destructive/15 text-destructive";
    case "pending":
      return "border-amber-500/60 bg-amber-500/15 text-amber-400";
    case "deleted":
      return "border-border/60 bg-muted text-muted-foreground line-through";
  }
}

function AuditRow({ entry, showTitle = false }: { entry: ModerationAuditEntry; showTitle?: boolean }) {
  const actionLabel: Record<ModerationAuditEntry["action"], string> = {
    approved: "Approved",
    rejected: "Rejected",
    pending: "Sent back to pending",
    deleted: "Deleted",
  };
  const actor = entry.actor_email ?? entry.actor_id ?? "unknown admin";
  return (
    <li className="flex flex-wrap items-baseline gap-2 border-b border-border/40 py-2 text-xs last:border-b-0">
      <span
        className={cn(
          "rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest",
          actionBadgeClass(entry.action),
        )}
        aria-label={`Action: ${actionLabel[entry.action]}`}
      >
        <span aria-hidden="true">{entry.action}</span>
      </span>
      {showTitle && (
        <span className="font-semibold text-foreground">
          {entry.item_title}
          {entry.item_kind && (
            <span className="ml-1 text-[10px] uppercase tracking-widest text-muted-foreground">
              <span aria-hidden="true">· </span>
              {entry.item_kind}
            </span>
          )}
        </span>
      )}
      <span className="text-muted-foreground">
        by {actor}
      </span>
      <span className="text-muted-foreground">
        <span aria-hidden="true">· </span>
        <time dateTime={entry.created_at}>
          {new Date(entry.created_at).toLocaleString()}
        </time>
      </span>
      {entry.previous_status && entry.previous_status !== entry.action && (
        <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
          (previously {entry.previous_status})
        </span>
      )}
      {entry.notes && (
        <div className="mt-1 w-full rounded border border-border/60 bg-muted/30 p-2 text-[11px] italic text-muted-foreground">
          <span className="sr-only">Moderator note: </span>
          “{entry.notes}”
        </div>
      )}
    </li>
  );
}

function ItemHistory({ contentItemId, itemTitle }: { contentItemId: string; itemTitle?: string }) {
  const listFn = useServerFn(adminListModerationAudit);
  const headingId = `moderation-history-heading-${contentItemId}`;
  const q = useQuery({
    queryKey: ["admin-moderation-audit", contentItemId],
    queryFn: () => listFn({ data: { contentItemId, limit: 50 } }),
  });

  if (q.isLoading) {
    return (
      <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
        Loading history{itemTitle ? ` for ${itemTitle}` : ""}…
      </p>
    );
  }
  if (q.error) {
    return (
      <p role="alert" className="text-xs text-destructive">
        Couldn't load history: {(q.error as Error).message}
      </p>
    );
  }
  const entries = q.data ?? [];
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No prior decisions recorded for this item yet.
      </p>
    );
  }
  return (
    <section
      role="region"
      aria-labelledby={headingId}
      className="rounded-lg border border-border/60 bg-background/60 p-3"
    >
      <h3
        id={headingId}
        className="mb-2 text-[10px] font-normal uppercase tracking-widest text-muted-foreground"
      >
        Moderation history{itemTitle ? ` for ${itemTitle}` : ""} · {entries.length} decision{entries.length === 1 ? "" : "s"}
      </h3>
      <ul aria-label="Moderation decisions, newest first">
        {entries.map((e) => (
          <AuditRow key={e.id} entry={e} />
        ))}
      </ul>
    </section>
  );
}


type AuditAction = "approved" | "rejected" | "pending" | "deleted";

function RecentActivityPanel() {
  const listFn = useServerFn(adminListModerationAudit);
  const [actorEmailInput, setActorEmailInput] = useState("");
  const [actorEmail, setActorEmail] = useState("");
  const [action, setAction] = useState<"" | AuditAction>("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  // Debounce the email input so we don't refetch on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setActorEmail(actorEmailInput.trim()), 300);
    return () => clearTimeout(t);
  }, [actorEmailInput]);

  const filters = {
    limit: 50,
    ...(actorEmail ? { actorEmail } : {}),
    ...(action ? { action } : {}),
    ...(from ? { from: new Date(from).toISOString() } : {}),
    // Treat the "to" date as end-of-day (local) for inclusive filtering.
    ...(to
      ? { to: new Date(new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1).toISOString() }
      : {}),
  };

  const q = useQuery({
    queryKey: ["admin-moderation-audit", "recent", filters],
    queryFn: () => listFn({ data: filters }),
  });

  const filtersActive = Boolean(actorEmail || action || from || to);
  const clearFilters = () => {
    setActorEmailInput("");
    setActorEmail("");
    setAction("");
    setFrom("");
    setTo("");
  };

  const exportCsv = () => {
    const rows = q.data ?? [];
    if (rows.length === 0) return;
    const headers = [
      "created_at",
      "action",
      "previous_status",
      "actor_email",
      "actor_id",
      "item_kind",
      "item_title",
      "content_item_id",
      "notes",
    ] as const;
    const escape = (v: unknown) => {
      const s = v == null ? "" : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      headers.join(","),
      ...rows.map((r) =>
        headers.map((h) => escape((r as unknown as Record<string, unknown>)[h])).join(","),
      ),
    ].join("\r\n");
    const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `moderation-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const canExport = Boolean(q.data && q.data.length > 0);

  return (
    <section className="mt-10 border-t border-border/60 pt-6">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-lg font-bold">Recent moderation activity</h2>
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Last 50 decisions{filtersActive ? " matching filters" : " across all items"}
          </span>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!canExport}
            className="rounded-md border border-border/60 px-3 py-1 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary/60 disabled:opacity-40 disabled:cursor-not-allowed"
            title={canExport ? "Download the visible decisions as CSV" : "No decisions to export"}
          >
            Export CSV
          </button>
        </div>
      </div>

      <div className="mb-4 grid gap-3 rounded-lg border border-border/60 bg-background/40 p-3 sm:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          Actor email
          <input
            type="search"
            value={actorEmailInput}
            onChange={(e) => setActorEmailInput(e.target.value)}
            placeholder="admin@…"
            className="rounded-md border border-border/60 bg-background/60 p-1.5 text-xs normal-case tracking-normal text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          Action
          <select
            value={action}
            onChange={(e) => setAction(e.target.value as "" | AuditAction)}
            className="rounded-md border border-border/60 bg-background/60 p-1.5 text-xs normal-case tracking-normal text-foreground"
          >
            <option value="">Any</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="pending">Sent back to pending</option>
            <option value="deleted">Deleted</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          From
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            max={to || undefined}
            className="rounded-md border border-border/60 bg-background/60 p-1.5 text-xs normal-case tracking-normal text-foreground"
          />
        </label>
        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-widest text-muted-foreground">
          To
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            min={from || undefined}
            className="rounded-md border border-border/60 bg-background/60 p-1.5 text-xs normal-case tracking-normal text-foreground"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={clearFilters}
            disabled={!filtersActive}
            className="w-full rounded-md border border-border/60 px-3 py-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:border-primary/60 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear filters
          </button>
        </div>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.error && (
        <p className="text-sm text-destructive">{(q.error as Error).message}</p>
      )}
      {q.data && q.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {filtersActive
            ? "No decisions match those filters. Try widening the range or clearing filters."
            : "No moderation decisions have been recorded yet. Approve, reject, or delete an item above and it will show up here."}
        </p>
      )}
      {q.data && q.data.length > 0 && (
        <ul className="rounded-lg border border-border/60 bg-background/60 p-3">
          {q.data.map((e) => (
            <AuditRow key={e.id} entry={e} showTitle />
          ))}
        </ul>
      )}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section className="mx-auto max-w-5xl px-5 pt-10 pb-16">
      <div className="mb-6">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
        <h1 className="mt-2 font-display text-3xl font-extrabold">Media moderation</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Review uploaded product photos and videos before they appear to customers. New submissions land in Pending.
        </p>
      </div>
      {children}
    </section>
  );
}
