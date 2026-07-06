import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { createContentItem } from "@/lib/store.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/content/new")({
  head: () => ({ meta: [{ title: "New item — Princess Pink" }] }),
  component: NewContentPage,
});

type MediaRow = { url: string; type: "image" | "video" };
type UploadError = { name: string; type: "image" | "video"; message: string };

function NewContentPage() {
  const createFn = useServerFn(createContentItem);
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const [kind, setKind] = useState<"photo_set" | "video" | "bundle">("photo_set");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [subscribersOnly, setSubscribersOnly] = useState(false);
  const [media, setMedia] = useState<MediaRow[]>([]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const create = useMutation({
    mutationFn: () =>
      createFn({
        data: {
          kind,
          title,
          description: description || undefined,
          cover_url: coverUrl || undefined,
          price_cents: priceDollars ? Math.round(parseFloat(priceDollars) * 100) : null,
          subscribers_only: subscribersOnly,
          media_urls: media,
          published: true,
        },
      }),
    onSuccess: () => {
      toast.success("Item created");
      navigate({ to: "/content" });
    },
    onError: (e) => toast.error(e.message),
  });

  async function uploadFile(file: File, type: "image" | "video"): Promise<string | null> {
    if (!userId) return null;
    const ext = file.name.split(".").pop() ?? "bin";
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabase.storage.from("content-media").upload(path, file, {
      contentType: file.type,
    });
    if (error) {
      toast.error(error.message);
      return null;
    }
    return path;
  }

  async function handleFiles(files: FileList | null, type: "image" | "video") {
    if (!files?.length) return;
    setUploading(true);
    const uploaded: MediaRow[] = [];
    for (const file of Array.from(files)) {
      const path = await uploadFile(file, type);
      if (path) uploaded.push({ url: path, type });
    }
    setMedia((m) => [...m, ...uploaded]);
    setUploading(false);
  }

  async function handleCover(file: File | null) {
    if (!file || !userId) return;
    setUploading(true);
    const path = await uploadFile(file, "image");
    if (path) {
      // Generate a long-ish signed URL for cover display
      const { data } = await supabase.storage.from("content-media").createSignedUrl(path, 60 * 60 * 24 * 365);
      if (data?.signedUrl) setCoverUrl(data.signedUrl);
    }
    setUploading(false);
  }

  return (
    <section className="mx-auto max-w-2xl px-5 py-10">
      <Link to="/content" className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground">
        ← Content
      </Link>
      <h1 className="mt-2 font-display text-3xl font-semibold">New item</h1>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!title.trim()) return toast.error("Title required");
          if (!subscribersOnly && !priceDollars) return toast.error("Set a price or mark as subscribers-only");
          create.mutate();
        }}
        className="mt-8 space-y-5"
      >
        <Field label="Type">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as any)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          >
            <option value="photo_set">Photo set</option>
            <option value="video">Video</option>
            <option value="bundle">Bundle</option>
          </select>
        </Field>

        <Field label="Title">
          <input
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
          />
        </Field>

        <Field label="Cover image">
          <input type="file" accept="image/*" onChange={(e) => handleCover(e.target.files?.[0] ?? null)} className="text-sm" />
          {coverUrl && <img src={coverUrl} alt="" className="mt-3 h-40 w-40 rounded-md object-cover" />}
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Price (USD)">
            <input
              type="number"
              step="0.01"
              min="0"
              placeholder="e.g. 12.00"
              value={priceDollars}
              onChange={(e) => setPriceDollars(e.target.value)}
              disabled={subscribersOnly}
              className="w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm disabled:opacity-50"
            />
          </Field>
          <Field label="Access">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={subscribersOnly}
                onChange={(e) => setSubscribersOnly(e.target.checked)}
              />
              Subscribers only
            </label>
          </Field>
        </div>

        <Field label="Media files">
          <div className="space-y-2">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Photos</label>
              <input type="file" accept="image/*" multiple onChange={(e) => handleFiles(e.target.files, "image")} className="mt-1 block text-sm" />
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Videos</label>
              <input type="file" accept="video/*" multiple onChange={(e) => handleFiles(e.target.files, "video")} className="mt-1 block text-sm" />
            </div>
            {uploading && <div className="text-xs text-muted-foreground">Uploading…</div>}
            {media.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {media.length} file(s) attached
              </div>
            )}
          </div>
        </Field>

        <button
          type="submit"
          disabled={create.isPending || uploading}
          className="w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] disabled:opacity-50"
        >
          {create.isPending ? "Saving…" : "Publish item"}
        </button>
      </form>
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
    </label>
  );
}
