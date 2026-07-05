import { createFileRoute, useRouter, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState } from "react";
import { EventForm, toPayload, type EventFormValues } from "@/components/EventForm";
import { getMyEvent, updateEvent, deleteEvent, addAccessCode, deleteAccessCode, bulkAddAccessCodes, setAccessCodeUsed, bulkSetAccessCodesUsed, updateAccessCodeGuestName } from "@/lib/host.functions";
import { toast } from "sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/events/$id/edit")({
  head: () => ({ meta: [{ title: "Edit event · AFTERDARK" }] }),
  component: EditEvent,
});

function toLocalDT(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function EditEvent() {
  const { id } = Route.useParams();
  const router = useRouter();
  const qc = useQueryClient();
  const getFn = useServerFn(getMyEvent);
  const updateFn = useServerFn(updateEvent);
  const deleteFn = useServerFn(deleteEvent);
  const addCode = useServerFn(addAccessCode);
  const delCode = useServerFn(deleteAccessCode);

  const q = useQuery({ queryKey: ["my-event", id], queryFn: () => getFn({ data: { id } }) });

  const update = useMutation({
    mutationFn: (payload: ReturnType<typeof toPayload>) => updateFn({ data: { id, ...payload } }),
    onSuccess: () => { toast.success("Saved"); qc.invalidateQueries({ queryKey: ["my-event", id] }); },
    onError: (e) => toast.error(e.message),
  });
  const del = useMutation({
    mutationFn: () => deleteFn({ data: { id } }),
    onSuccess: () => { toast.success("Event deleted"); router.navigate({ to: "/dashboard" }); },
  });
  const [newCode, setNewCode] = useState("");
  const [newNote, setNewNote] = useState("");
  const addC = useMutation({
    mutationFn: () => addCode({ data: { event_id: id, code: newCode.trim().toUpperCase(), note: newNote || undefined } }),
    onSuccess: () => { setNewCode(""); setNewNote(""); toast.success("Code added"); qc.invalidateQueries({ queryKey: ["my-event", id] }); },
    onError: (e) => toast.error(e.message),
  });
  const delC = useMutation({
    mutationFn: (codeId: string) => delCode({ data: { id: codeId } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-event", id] }),
  });

  const markUsedFn = useServerFn(setAccessCodeUsed);
  const markUsed = useMutation({
    mutationFn: (v: { id: string; used: boolean; used_by_name?: string }) => markUsedFn({ data: v }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["my-event", id] }),
    onError: (e) => toast.error(e.message),
  });

  const renameFn = useServerFn(updateAccessCodeGuestName);
  const renameGuest = useMutation({
    mutationFn: (v: { id: string; used_by_name: string }) => renameFn({ data: v }),
    onSuccess: () => { toast.success("Guest name updated"); qc.invalidateQueries({ queryKey: ["my-event", id] }); },
    onError: (e) => toast.error(e.message),
  });

  const bulkMarkFn = useServerFn(bulkSetAccessCodesUsed);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkGuestName, setBulkGuestName] = useState("");
  const [confirmBulk, setConfirmBulk] = useState<null | { used: boolean }>(null);
  const bulkMark = useMutation({
    mutationFn: (v: { used: boolean }) =>
      bulkMarkFn({
        data: {
          ids: Array.from(selected),
          used: v.used,
          // Guest name is only sent when marking used; ignored on unmark.
          used_by_name: v.used ? bulkGuestName.trim() : undefined,
        },
      }),
    onSuccess: (r, v) => {
      toast.success(`${v.used ? "Marked" : "Unmarked"} ${r.count} code${r.count === 1 ? "" : "s"}`);
      setSelected(new Set()); setBulkGuestName("");
      qc.invalidateQueries({ queryKey: ["my-event", id] });
    },
    onError: (e) => toast.error(e.message),
  });

  const bulkFn = useServerFn(bulkAddAccessCodes);
  const [bulkQty, setBulkQty] = useState(10);
  const [bulkPrefix, setBulkPrefix] = useState("PINK");
  const [bulkNote, setBulkNote] = useState("");
  const [minted, setMinted] = useState<string[]>([]);
  const bulk = useMutation({
    mutationFn: () => bulkFn({ data: { event_id: id, quantity: bulkQty, prefix: bulkPrefix, note: bulkNote || undefined } }),
    onSuccess: (r) => {
      setMinted(r.codes.map((c) => c.code));
      toast.success(`Minted ${r.codes.length} codes`);
      qc.invalidateQueries({ queryKey: ["my-event", id] });
    },
    onError: (e) => toast.error(e.message),
  });

  if (q.isLoading) return <div className="mx-auto max-w-3xl px-5 py-10">Loading…</div>;
  if (q.isError || !q.data) return <div className="mx-auto max-w-3xl px-5 py-10">Not found.</div>;

  const { event, codes, rsvps } = q.data;
  const initial: Partial<EventFormValues> = {
    title: event.title, tagline: event.tagline ?? "", description: event.description ?? "",
    venue_name: event.venue_name, address: event.address ?? "", city: event.city ?? "",
    starts_at: toLocalDT(event.starts_at), ends_at: toLocalDT(event.ends_at),
    dress_code: event.dress_code ?? "", theme: event.theme ?? "",
    capacity: event.capacity ? String(event.capacity) : "",
    ticket_price_cents: String(event.ticket_price_cents ?? 0),
    cover_image_url: event.cover_image_url ?? "",
    is_private: event.is_private, published: event.published,
  };

  return (
    <section className="mx-auto max-w-3xl px-5 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Editing</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">{event.title}</h1>
        </div>
        <Link to="/events/$id" params={{ id }} className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
          View public →
        </Link>
      </div>

      <div className="mt-8">
        <EventForm initial={initial} submitLabel="Save changes" submitting={update.isPending}
          onSubmit={(v) => update.mutate(toPayload(v))} />
      </div>

      {event.is_private && (
        <div className="mt-10 rounded-2xl border border-border/60 bg-card/60 p-6">
          <div className="text-[10px] uppercase tracking-[0.3em] text-primary mb-4">Access codes</div>
          <p className="text-xs text-muted-foreground mb-4">
            Share a code so guests can unlock this private invitation via <span className="font-mono">/unlock</span>.
          </p>
          <div className="flex flex-wrap gap-2">
            <input placeholder="PINK-XXXX" value={newCode} onChange={(e) => setNewCode(e.target.value)}
              className="flex-1 min-w-[140px] rounded-md border border-input bg-background px-3 py-2 font-mono text-sm uppercase" />
            <button type="button"
              onClick={() => {
                const rand = Array.from({ length: 6 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
                setNewCode(`PINK-${rand}`);
              }}
              className="rounded-md border border-border px-3 py-2 text-xs uppercase tracking-widest hover:bg-secondary/50">
              Generate
            </button>
            <input placeholder="Note (optional)" value={newNote} onChange={(e) => setNewNote(e.target.value)}
              className="w-48 rounded-md border border-input bg-background px-3 py-2 text-sm" />
            <button onClick={() => addC.mutate()} disabled={!newCode.trim() || addC.isPending}
              className="rounded-md bg-primary px-4 text-xs font-semibold uppercase tracking-widest text-primary-foreground">
              Add
            </button>
          </div>
          {codes.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <label className="flex items-center gap-2 text-muted-foreground">
                <input type="checkbox"
                  checked={selected.size === codes.length}
                  ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < codes.length; }}
                  onChange={(e) => setSelected(e.target.checked ? new Set(codes.map((c) => c.id)) : new Set())} />
                Select all
              </label>
              <span className="text-muted-foreground">· {selected.size} selected</span>
              {selected.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 ml-auto">
                  <input value={bulkGuestName} onChange={(e) => setBulkGuestName(e.target.value)}
                    placeholder="Guest name (required to mark used)"
                    maxLength={120}
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs w-56" />
                  <button
                    disabled={bulkMark.isPending || !bulkGuestName.trim()}
                    title={!bulkGuestName.trim() ? "Enter a guest name to mark codes as used" : undefined}
                    onClick={() => {
                      if (!bulkGuestName.trim()) { toast.error("Guest name is required to mark codes as used"); return; }
                      setConfirmBulk({ used: true });
                    }}
                    className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50">
                    Mark used
                  </button>
                  <button disabled={bulkMark.isPending} onClick={() => setConfirmBulk({ used: false })}
                    className="rounded-md border border-border px-3 py-1.5 text-[11px] uppercase tracking-widest hover:bg-secondary/50 disabled:opacity-50">
                    Unmark
                  </button>
                </div>
              )}
            </div>
          )}
          <ul className="mt-4 space-y-2">
            {codes.map((c) => (
              <AccessCodeRow key={c.id} c={c}
                selected={selected.has(c.id)}
                onSelect={(checked) => setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(c.id); else next.delete(c.id);
                  return next;
                })}
                onDelete={() => delC.mutate(c.id)}
                onToggle={(used, name) => markUsed.mutate({ id: c.id, used, used_by_name: name })}
                onRename={(name) => renameGuest.mutate({ id: c.id, used_by_name: name })}
                pending={
                  (markUsed.isPending && markUsed.variables?.id === c.id) ||
                  (renameGuest.isPending && renameGuest.variables?.id === c.id)
                } />
            ))}
            {!codes.length && <li className="text-xs text-muted-foreground">No codes yet.</li>}
          </ul>

          <div className="mt-6 border-t border-border/50 pt-6">
            <div className="text-[10px] uppercase tracking-[0.3em] text-primary mb-3">Bulk mint</div>
            <div className="grid gap-2 sm:grid-cols-[100px_140px_1fr_auto]">
              <input type="number" min={1} max={200} value={bulkQty}
                onChange={(e) => setBulkQty(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <input value={bulkPrefix} onChange={(e) => setBulkPrefix(e.target.value.replace(/[^A-Za-z0-9]/g, "").slice(0, 16))}
                placeholder="PREFIX"
                className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm uppercase" />
              <input value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} placeholder="Note (optional)"
                className="rounded-md border border-input bg-background px-3 py-2 text-sm" />
              <button onClick={() => bulk.mutate()} disabled={bulk.isPending || !bulkPrefix}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50">
                {bulk.isPending ? "Minting…" : `Mint ${bulkQty}`}
              </button>
            </div>
            {minted.length > 0 && (
              <div className="mt-4 rounded-md border border-primary/40 bg-primary/5 p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Just minted · {minted.length}</div>
                  <button onClick={() => { navigator.clipboard.writeText(minted.join("\n")); toast.success("Copied"); }}
                    className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
                    Copy all
                  </button>
                </div>
                <pre className="max-h-40 overflow-auto font-mono text-xs text-neon whitespace-pre-wrap">{minted.join("\n")}</pre>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="mt-10 rounded-2xl border border-border/60 bg-card/60 p-6">
        <div className="flex items-center justify-between gap-2 mb-4">
          <div className="text-[10px] uppercase tracking-[0.3em] text-primary">Guest list · {rsvps.length}</div>
          {rsvps.length > 0 && (
            <button
              onClick={() => {
                const text = rsvps
                  .map((r) => `${r.ticket_code}\t${r.display_name ?? "Guest"}\t${r.guest_count}`)
                  .join("\n");
                navigator.clipboard.writeText(text);
                toast.success("Guest list copied");
              }}
              className="text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              Copy all
            </button>
          )}
        </div>
        {rsvps.length ? (
          <ul className="divide-y divide-border/50">
            {rsvps.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <div className="truncate">{r.display_name ?? "Guest"}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.guest_count} guest{r.guest_count > 1 ? "s" : ""} · {new Date(r.created_at).toLocaleDateString()}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <code className="font-mono text-xs text-neon">{r.ticket_code}</code>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(r.ticket_code);
                      toast.success(`Copied ${r.ticket_code}`);
                    }}
                    className="rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-widest hover:bg-secondary/50"
                  >
                    Copy
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">No RSVPs yet.</p>}
      </div>

      <div className="mt-10 rounded-2xl border border-destructive/40 bg-destructive/5 p-6">
        <div className="text-[10px] uppercase tracking-[0.3em] text-destructive mb-2">Danger zone</div>
        <button
          onClick={() => { if (confirm("Delete this event permanently?")) del.mutate(); }}
          className="rounded-md border border-destructive/60 px-4 py-2 text-xs uppercase tracking-widest text-destructive hover:bg-destructive/20"
        >
          Delete event
        </button>
      </div>



      <AlertDialog open={!!confirmBulk} onOpenChange={(o) => !o && setConfirmBulk(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmBulk?.used ? "Mark codes as used?" : "Unmark codes?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmBulk?.used
                ? `This will mark ${selected.size} access code${selected.size === 1 ? "" : "s"} as used and record the guest name "${bulkGuestName.trim()}".`
                : `This will clear the used status on ${selected.size} access code${selected.size === 1 ? "" : "s"}, allowing them to unlock the invitation again. Any guest name entered above will be ignored.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmBulk) bulkMark.mutate({ used: confirmBulk.used });
                setConfirmBulk(null);
              }}
            >
              {confirmBulk?.used ? "Mark used" : "Unmark"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

type CodeRow = {
  id: string;
  code: string;
  note: string | null;
  used_at: string | null;
  used_by_name: string | null;
};

function AccessCodeRow({
  c, onDelete, onToggle, onRename, pending, selected, onSelect,
}: {
  c: CodeRow;
  onDelete: () => void;
  onToggle: (used: boolean, name?: string) => void;
  onRename: (name: string) => void;
  pending: boolean;
  selected: boolean;
  onSelect: (checked: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(c.used_by_name ?? "");
  const [nameDraft, setNameDraft] = useState(c.used_by_name ?? "");
  const used = !!c.used_at;
  const reactId = useId();
  const markInputId = `${reactId}-mark-name`;
  const markHelpId = `${reactId}-mark-help`;
  const renameInputId = `${reactId}-rename-name`;
  const renameHelpId = `${reactId}-rename-help`;
  const editRegionId = `${reactId}-edit-region`;
  const renameRegionId = `${reactId}-rename-region`;
  const markTriggerRef = useRef<HTMLButtonElement>(null);
  const renameTriggerRef = useRef<HTMLButtonElement>(null);

  const closeEditing = () => {
    setEditing(false);
    // Return focus to the trigger for keyboard users
    requestAnimationFrame(() => markTriggerRef.current?.focus());
  };
  const closeRenaming = () => {
    setEditingName(false);
    requestAnimationFrame(() => renameTriggerRef.current?.focus());
  };

  const submitMark = () => {
    const n = name.trim();
    if (!n) { toast.error("Guest name is required to mark this code as used"); return; }
    onToggle(true, n);
    setEditing(false);
  };
  const submitRename = () => {
    const n = nameDraft.trim();
    if (!n) { toast.error("Guest name is required"); return; }
    if (n === (c.used_by_name ?? "")) return;
    onRename(n);
    setEditingName(false);
  };

  return (
    <li className={`rounded-md border px-3 py-2 text-sm ${used ? "border-primary/40 bg-primary/5" : "border-border/50"}`}>
      <div className="flex items-center justify-between gap-3">
        <input type="checkbox" checked={selected} onChange={(e) => onSelect(e.target.checked)}
          className="shrink-0" aria-label={`Select access code ${c.code}`} />
        <div className="min-w-0 flex-1">
          <div className={`font-mono ${used ? "text-muted-foreground line-through" : ""}`}>{c.code}</div>
          {used && (
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              Used {new Date(c.used_at!).toLocaleDateString()}
              {c.used_by_name ? ` · ${c.used_by_name}` : ""}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          {c.note && !used && <span className="text-xs text-muted-foreground">{c.note}</span>}
          {used ? (
            <>
              <button
                ref={renameTriggerRef}
                disabled={pending}
                aria-expanded={editingName}
                aria-controls={renameRegionId}
                aria-label={editingName ? `Close guest name editor for ${c.code}` : `Edit guest name for ${c.code}`}
                onClick={() => { setNameDraft(c.used_by_name ?? ""); setEditingName((v) => !v); }}
                className="text-xs uppercase tracking-widest text-primary hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                {editingName ? "Close" : "Edit name"}
              </button>
              <button
                disabled={pending}
                onClick={() => onToggle(false)}
                aria-label={`Unmark ${c.code} as used`}
                className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                Unmark
              </button>
            </>
          ) : (
            <button
              ref={markTriggerRef}
              disabled={pending}
              aria-expanded={editing}
              aria-controls={editRegionId}
              aria-label={editing ? `Close mark-used editor for ${c.code}` : `Mark ${c.code} as used`}
              onClick={() => setEditing((v) => !v)}
              className="text-xs uppercase tracking-widest text-primary hover:brightness-125 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
              Mark used
            </button>
          )}
          <button
            onClick={onDelete}
            aria-label={`Delete access code ${c.code}`}
            className="text-xs text-muted-foreground hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
            Delete
          </button>
        </div>
      </div>
      {editing && !used && (
        <div
          id={editRegionId}
          role="group"
          aria-label={`Mark ${c.code} as used`}
          className="mt-2 flex flex-wrap gap-2"
        >
          <label htmlFor={markInputId} className="sr-only">Guest name for {c.code}</label>
          <input
            id={markInputId}
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submitMark(); }
              else if (e.key === "Escape") { e.preventDefault(); closeEditing(); }
            }}
            placeholder="Guest name (required)"
            maxLength={120}
            required
            aria-required="true"
            aria-invalid={!name.trim()}
            aria-describedby={markHelpId}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <p id={markHelpId} className="sr-only">
            Guest name is required. Press Enter to confirm or Escape to cancel.
          </p>
          <button
            type="button"
            disabled={pending || !name.trim()}
            title={!name.trim() ? "Guest name is required" : undefined}
            onClick={submitMark}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Confirm
          </button>
          <button
            type="button"
            onClick={closeEditing}
            className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Cancel
          </button>
        </div>
      )}
      {editingName && used && (
        <div
          id={renameRegionId}
          role="group"
          aria-label={`Edit guest name for ${c.code}`}
          className="mt-2 flex flex-wrap gap-2"
        >
          <label htmlFor={renameInputId} className="sr-only">Guest name for {c.code}</label>
          <input
            id={renameInputId}
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); submitRename(); }
              else if (e.key === "Escape") { e.preventDefault(); closeRenaming(); }
            }}
            placeholder="Guest name (required)"
            maxLength={120}
            required
            aria-required="true"
            aria-invalid={!nameDraft.trim()}
            aria-describedby={renameHelpId}
            className="flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <p id={renameHelpId} className="sr-only">
            Guest name is required. Press Enter to save or Escape to cancel.
          </p>
          <button
            type="button"
            disabled={pending || !nameDraft.trim() || nameDraft.trim() === (c.used_by_name ?? "")}
            title={!nameDraft.trim() ? "Guest name is required" : undefined}
            onClick={submitRename}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Save
          </button>
          <button
            type="button"
            onClick={closeRenaming}
            className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-widest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Cancel
          </button>
        </div>
      )}
    </li>
  );
}
