import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  createPantyListing,
  updatePantyListing,
  deletePantyListing,
  type PantyListing,
} from "@/lib/pantyListings.functions";
import { describePantyPhoto } from "@/lib/panty-ai.functions";
import { toast } from "sonner";
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

export const Route = createFileRoute("/_authenticated/admin/panty-listings")({
  head: () => ({ meta: [{ title: "Panty Listings · Admin" }] }),
  component: AdminPantyListings,
  errorComponent: ({ error }) => (
    <div className="p-8 text-sm text-destructive">Error: {error.message}</div>
  ),
  notFoundComponent: () => <div className="p-8">Not found</div>,
});

type EditState = Partial<PantyListing> & { id?: string };

function emptyEdit(): EditState {
  return {
    title: "",
    description: "",
    color: "",
    style: "",
    size: "",
    cover_url: "",
    media_urls: [],
    price_cents: null,
    published: false,
    sold: false,
    sort_order: 0,
  };
}

function AdminPantyListings() {
  const createFn = useServerFn(createPantyListing);
  const updateFn = useServerFn(updatePantyListing);
  const deleteFn = useServerFn(deletePantyListing);
  const qc = useQueryClient();
  const listings = useQuery({
    queryKey: ["admin-panty-listings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("panty_listings")
        .select(
          "id,title,description,color,style,size,cover_url,media_urls,price_cents,currency,published,sold,sort_order,created_at",
        )
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: false });
      if (error) throw new Error(error.message);
      return (data ?? []) as PantyListing[];
    },
  });
  const [edit, setEdit] = useState<EditState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PantyListing | null>(null);

  const save = useMutation({
    mutationFn: async (v: EditState) => {
      const payload = {
        title: v.title ?? "",
        description: v.description ?? null,
        color: v.color ?? null,
        style: v.style ?? null,
        size: v.size ?? null,
        cover_url: v.cover_url ?? null,
        media_urls: v.media_urls ?? [],
        price_cents: v.price_cents ?? null,
        published: !!v.published,
        sold: !!v.sold,
        sort_order: v.sort_order ?? 0,
      };
      if (v.id) return updateFn({ data: { id: v.id, ...payload } });
      return createFn({ data: payload });
    },
    onSuccess: () => {
      toast.success("Saved");
      setEdit(null);
      qc.invalidateQueries({ queryKey: ["admin-panty-listings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-panty-listings"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <section className="mx-auto max-w-5xl px-5 py-10">
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
          <h1 className="mt-2 font-display text-3xl font-semibold">Panty Drawer listings</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Individual pairs shown in the panty drawer gallery. Buyers still pick a wear time
            (24 / 48 / 72 hr) at checkout.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/dashboard"
            className="rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest hover:bg-muted/30"
          >
            Dashboard
          </Link>
          <button
            type="button"
            onClick={() => setEdit(emptyEdit())}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
          >
            + New pair
          </button>
        </div>
      </div>

      {listings.isLoading && <p className="mt-8 text-sm text-muted-foreground">Loading…</p>}

      {listings.isError && (
        <div className="mt-8 rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <div className="font-semibold">Failed to load listings</div>
          <div className="mt-1 opacity-80">{(listings.error as Error)?.message ?? "Unknown error"}</div>
          <button
            type="button"
            onClick={() => listings.refetch()}
            className="mt-3 rounded-md border border-destructive/40 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest hover:bg-destructive/20"
          >
            Retry
          </button>
        </div>
      )}

      {!listings.isLoading && !listings.isError && (listings.data ?? []).length === 0 && (
        <div className="mt-8 rounded-md border border-dashed border-border/60 bg-card/20 p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No pairs yet. Click <span className="font-semibold text-foreground">+ New pair</span> above to add your first listing.
          </p>
        </div>
      )}

      <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(listings.data ?? []).map((l) => (
          <li
            key={l.id}
            className="overflow-hidden rounded-lg border border-border/60 bg-card/40"
          >
            <div className="aspect-square bg-muted/20">
              {l.cover_url ? (
                <img src={l.cover_url} alt={l.title} className="h-full w-full object-cover" />
              ) : (
                <div className="grid h-full place-items-center text-xs text-muted-foreground">
                  No photo
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="font-semibold">{l.title}</div>
                <div className="flex gap-1">
                  {l.sold && (
                    <span className="rounded-full border border-muted-foreground/40 bg-muted/30 px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
                      Sold
                    </span>
                  )}
                  {l.published ? (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-emerald-500">
                      Live
                    </span>
                  ) : (
                    <span className="rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-500">
                      Draft
                    </span>
                  )}
                </div>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {[l.color, l.style, l.size].filter(Boolean).join(" · ") || "—"}
              </div>
              {l.price_cents != null && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Suggested: A${(l.price_cents / 100).toFixed(2)}
                </div>
              )}
              <div className="mt-3 flex gap-2">
                <button
                  type="button"
                  onClick={() => setEdit(l)}
                  className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary hover:bg-primary/20"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => setPendingDelete(l)}
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-destructive hover:bg-destructive/20"
                >
                  Delete
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {edit && (
        <EditModal
          value={edit}
          onChange={setEdit}
          onClose={() => setEdit(null)}
          onSave={() => save.mutate(edit)}
          saving={save.isPending}
        />
      )}

      <AlertDialog
        open={!!pendingDelete}
        onOpenChange={(o) => {
          if (!o && !remove.isPending) setPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this pair?</AlertDialogTitle>
            <AlertDialogDescription>
              {pendingDelete
                ? `"${pendingDelete.title}" will be permanently removed from the panty drawer. This cannot be undone.`
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (!pendingDelete) return;
                remove.mutate(pendingDelete.id, {
                  onSettled: () => setPendingDelete(null),
                });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function EditModal(props: {
  value: EditState;
  onChange: (v: EditState) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
}) {
  const { value, onChange } = props;
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [autoCreating, setAutoCreating] = useState(false);
  const describeFn = useServerFn(describePantyPhoto);
  const createFn = useServerFn(createPantyListing);
  const qc = useQueryClient();

  const autoDescribe = async (imageUrl: string) => {
    if (!imageUrl) {
      toast.error("No image uploaded", {
        description: "Upload a cover photo first, then click AI Auto-Describe.",
        duration: 6000,
      });
      return;
    }
    setDescribing(true);
    try {
      const result = await describeFn({ data: { imageUrl } });
      if (!result.title && !result.description) {
        toast.error("AI couldn't read that photo", {
          description: "Try a clearer, well-lit shot of a single pair.",
          duration: 6000,
        });
        return;
      }
      onChange({
        ...value,
        title: value.title && value.title.trim() ? value.title : result.title,
        description:
          value.description && value.description.trim()
            ? value.description
            : result.description,
      });
      toast.success("Filled title & description", {
        description: "Review and tweak before saving.",
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error("[AI Auto-Describe] failed:", e);
      toast.error("AI Auto-Describe failed", {
        description: message,
        duration: 10000,
      });
    } finally {
      setDescribing(false);
    }
  };


  const uploadPhoto = async (file: File, target: "cover" | "media") => {
    setUploading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) throw new Error("Sign in required");
      const ext = file.name.split(".").pop() ?? "jpg";
      const path = `${userId}/panty-listings/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("content-media")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { data: signed, error: sErr } = await supabase.storage
        .from("content-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (sErr || !signed?.signedUrl) throw sErr ?? new Error("Could not sign URL");
      if (target === "cover") {
        onChange({ ...value, cover_url: signed.signedUrl });
      } else {
        onChange({
          ...value,
          media_urls: [...(value.media_urls ?? []), signed.signedUrl],
        });
      }
      toast.success("Photo uploaded");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg border border-border bg-background p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-semibold">
            {value.id ? "Edit pair" : "New pair"}
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-4">
          <Field label="Title">
            <input
              value={value.title ?? ""}
              onChange={(e) => onChange({ ...value, title: e.target.value })}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              placeholder="e.g. Pink lace thong"
            />
          </Field>

          <Field label="Description (optional)">
            <textarea
              value={value.description ?? ""}
              onChange={(e) => onChange({ ...value, description: e.target.value })}
              rows={4}
              maxLength={2000}
              placeholder="Optional — size, fabric, wear notes, or anything else buyers should know."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="Colour">
              <input
                value={value.color ?? ""}
                onChange={(e) => onChange({ ...value, color: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Style">
              <input
                value={value.style ?? ""}
                onChange={(e) => onChange({ ...value, style: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="thong / boyshort / g-string"
              />
            </Field>
            <Field label="Size">
              <input
                value={value.size ?? ""}
                onChange={(e) => onChange({ ...value, size: e.target.value })}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="S / M / L"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Sort order (lower = first)">
              <input
                type="number"
                value={value.sort_order ?? 0}
                onChange={(e) =>
                  onChange({ ...value, sort_order: Number(e.target.value) || 0 })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </Field>
            <Field label="Suggested price (cents, optional)">
              <input
                type="number"
                value={value.price_cents ?? ""}
                onChange={(e) =>
                  onChange({
                    ...value,
                    price_cents: e.target.value === "" ? null : Number(e.target.value),
                  })
                }
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                placeholder="e.g. 9000 (= A$90)"
              />
            </Field>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Cover photo</div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              {value.cover_url && (
                <img
                  src={value.cover_url}
                  alt=""
                  className="h-24 w-24 rounded-md object-cover"
                />
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                disabled={uploading || describing}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) uploadPhoto(f, "cover");
                }}
                className="text-xs"
              />
              <button
                type="button"
                onClick={() => autoDescribe(value.cover_url ?? "")}
                disabled={!value.cover_url || uploading || describing}
                title={
                  value.cover_url
                    ? "Use AI to draft the title & description from the cover photo"
                    : "Upload a cover photo first"
                }
                className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-widest text-primary transition hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {describing ? (
                  <>
                    <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-primary/40 border-t-primary" />
                    Describing…
                  </>
                ) : (
                  <>✨ AI Auto-Describe</>
                )}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              AI drafts fill only empty fields — your edits are never overwritten. Review before saving.
            </p>
          </div>

          <div>
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Extra photos ({(value.media_urls ?? []).length})
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(value.media_urls ?? []).map((u, i) => (
                <div key={u} className="relative">
                  <img src={u} alt="" className="h-20 w-20 rounded-md object-cover" />
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        ...value,
                        media_urls: (value.media_urls ?? []).filter((_, j) => j !== i),
                      })
                    }
                    className="absolute -right-2 -top-2 rounded-full bg-destructive px-1.5 py-0.5 text-[10px] text-destructive-foreground"
                  >
                    ×
                  </button>
                </div>
              ))}
              <label className="grid h-20 w-20 cursor-pointer place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-muted/20">
                +
                <input
                  type="file"
                  accept="image/*"
                  disabled={uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadPhoto(f, "media");
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          <div className="flex flex-wrap gap-6 pt-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!value.published}
                onChange={(e) => onChange({ ...value, published: e.target.checked })}
              />
              Published (show in store)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={!!value.sold}
                onChange={(e) => onChange({ ...value, sold: e.target.checked })}
              />
              Sold (hide from gallery)
            </label>
          </div>
        </div>

        {!value.id && ((value.cover_url ?? "") || (value.media_urls ?? []).length > 0) && (
          <div
            role="alert"
            className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200"
          >
            <div className="font-semibold uppercase tracking-widest">Photo uploaded — listing not saved yet</div>
            <p className="mt-1 opacity-90">
              You've uploaded {(value.cover_url ? 1 : 0) + (value.media_urls ?? []).length}{" "}
              photo{(value.cover_url ? 1 : 0) + (value.media_urls ?? []).length === 1 ? "" : "s"} but the
              listing row hasn't been created. Click <span className="font-semibold">Save</span> to attach
              them to a new pair — closing this dialog will leave the file{(value.cover_url ? 1 : 0) + (value.media_urls ?? []).length === 1 ? "" : "s"} orphaned in storage.
            </p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className="rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest hover:bg-muted/30"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={props.onSave}
            disabled={
              props.saving ||
              uploading ||
              describing ||
              !(value.description ?? "").trim()
            }
            title={
              !(value.description ?? "").trim()
                ? "Add a description (or use ✨ AI Auto-Describe) before saving"
                : undefined
            }
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {props.saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1">{children}</div>
    </label>
  );
}
