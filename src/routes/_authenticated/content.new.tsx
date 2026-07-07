import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { createContentItem } from "@/lib/store.functions";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/content/new")({
  head: () => ({ meta: [{ title: "New item — Princess Pink" }] }),
  component: NewContentPage,
});

type MediaRow = { url: string; type: "image" | "video" };
type UploadStatus = "uploading" | "done" | "error" | "stalled";
type UploadItem = {
  id: string;
  file: File;
  name: string;
  size: number;
  type: "image" | "video";
  slot: "media" | "cover";
  loaded: number;
  status: UploadStatus;
  message?: string;
  path?: string;
};

// If no progress event fires for this long, the upload is treated as stalled.
const STALL_MS = 15000;

// Client-side upload limits (server enforces its own limits too).
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"];
const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif", "avif"];
const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const VIDEO_EXTS = ["mp4", "webm", "mov", "m4v"];
const MAX_IMAGE_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_VIDEO_BYTES = 500 * 1024 * 1024; // 500 MB

function validateFile(file: File, type: "image" | "video"): string | null {
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "";
  const allowedTypes = type === "image" ? IMAGE_TYPES : VIDEO_TYPES;
  const allowedExts = type === "image" ? IMAGE_EXTS : VIDEO_EXTS;
  const maxBytes = type === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES;
  const maxLabel = type === "image" ? "15 MB" : "500 MB";
  const kindLabel = type === "image" ? "image" : "video";

  const mimeOk = file.type ? allowedTypes.includes(file.type) : false;
  const extOk = ext ? allowedExts.includes(ext) : false;
  if (!mimeOk && !extOk) {
    return `"${file.name}" isn't a supported ${kindLabel}. Allowed: ${allowedExts.join(", ").toUpperCase()}.`;
  }
  if (file.type && !file.type.startsWith(type === "image" ? "image/" : "video/")) {
    return `"${file.name}" isn't a ${kindLabel} file (detected ${file.type}).`;
  }
  if (file.size === 0) {
    return `"${file.name}" is empty.`;
  }
  if (file.size > maxBytes) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return `"${file.name}" is ${mb} MB — max ${maxLabel} for ${kindLabel}s.`;
  }
  return null;
}


function NewContentPage() {
  const createFn = useServerFn(createContentItem);
  const navigate = useNavigate();
  const [userId, setUserId] = useState<string | null>(null);

  const [kind, setKind] = useState<"photo_set" | "video" | "bundle">("photo_set");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [priceDollars, setPriceDollars] = useState("");
  const [subscribersOnly, setSubscribersOnly] = useState(false);
  const [media, setMedia] = useState<MediaRow[]>([]);
  const [uploads, setUploads] = useState<UploadItem[]>([]);

  // Track active XHRs so retry/cancel can abort them.
  const xhrs = useRef<Map<string, XMLHttpRequest>>(new Map());
  const stallTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const busyUploads = uploads.some((u) => u.status === "uploading");

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

  function patch(id: string, changes: Partial<UploadItem>) {
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  }

  function clearStall(id: string) {
    const t = stallTimers.current.get(id);
    if (t) clearTimeout(t);
    stallTimers.current.delete(id);
  }

  function armStall(id: string) {
    clearStall(id);
    stallTimers.current.set(
      id,
      setTimeout(() => {
        const xhr = xhrs.current.get(id);
        if (xhr) xhr.abort();
        patch(id, { status: "stalled", message: "No progress for 15s. Retry?" });
      }, STALL_MS),
    );
  }

  async function startUpload(item: UploadItem) {
    if (!userId) {
      patch(item.id, { status: "error", message: "You must be signed in to upload." });
      return;
    }
    const expectedPrefix = item.type === "image" ? "image/" : "video/";
    if (item.file.type && !item.file.type.startsWith(expectedPrefix)) {
      patch(item.id, {
        status: "error",
        message: `Not a ${item.type} file (detected ${item.file.type}).`,
      });
      return;
    }

    const ext = item.file.name.split(".").pop() ?? "bin";
    const path = item.path ?? `${userId}/${crypto.randomUUID()}.${ext}`;

    patch(item.id, { status: "uploading", loaded: 0, message: undefined, path });

    // Request a signed upload URL so we can PUT via XHR and observe progress.
    const { data: signed, error: signErr } = await supabase.storage
      .from("content-media")
      .createSignedUploadUrl(path);
    if (signErr || !signed) {
      patch(item.id, {
        status: "error",
        message: signErr?.message ?? "Could not prepare upload.",
      });
      return;
    }

    const xhr = new XMLHttpRequest();
    xhrs.current.set(item.id, xhr);
    xhr.open("PUT", signed.signedUrl);
    if (item.file.type) xhr.setRequestHeader("Content-Type", item.file.type);
    xhr.setRequestHeader("x-upsert", "true");

    armStall(item.id);

    xhr.upload.addEventListener("progress", (ev) => {
      if (!ev.lengthComputable) return;
      patch(item.id, { loaded: ev.loaded });
      armStall(item.id);
    });

    xhr.addEventListener("load", async () => {
      clearStall(item.id);
      xhrs.current.delete(item.id);
      if (xhr.status >= 200 && xhr.status < 300) {
        patch(item.id, { status: "done", loaded: item.size });
        if (item.slot === "media") {
          setMedia((m) => [...m, { url: path, type: item.type }]);
        } else {
          const { data, error } = await supabase.storage
            .from("content-media")
            .createSignedUrl(path, 60 * 60 * 24 * 365);
          if (error || !data?.signedUrl) {
            patch(item.id, {
              status: "error",
              message: error?.message ?? "Could not generate cover preview.",
            });
          } else {
            setCoverUrl(data.signedUrl);
          }
        }
      } else {
        patch(item.id, {
          status: "error",
          message: `Upload failed (HTTP ${xhr.status}).`,
        });
      }
    });

    xhr.addEventListener("error", () => {
      clearStall(item.id);
      xhrs.current.delete(item.id);
      patch(item.id, { status: "error", message: "Network error. Retry?" });
    });

    xhr.addEventListener("abort", () => {
      xhrs.current.delete(item.id);
      // Status is set by whoever called abort (stall timer or cancel button).
    });

    xhr.send(item.file);
  }

  function queueFiles(files: FileList | null, type: "image" | "video", slot: "media" | "cover") {
    if (!files?.length) return;
    const accepted: File[] = [];
    for (const file of Array.from(files)) {
      const err = validateFile(file, type);
      if (err) {
        toast.error(err);
        continue;
      }
      accepted.push(file);
    }
    if (!accepted.length) return;
    const items: UploadItem[] = accepted.map((file) => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      type,
      slot,
      loaded: 0,
      status: "uploading",
    }));
    setUploads((list) => [...list, ...items]);
    items.forEach((it) => void startUpload(it));
  }


  function retry(id: string) {
    const item = uploads.find((u) => u.id === id);
    if (!item) return;
    void startUpload({ ...item, loaded: 0 });
  }

  function cancel(id: string) {
    const xhr = xhrs.current.get(id);
    if (xhr) xhr.abort();
    clearStall(id);
    setUploads((list) => list.filter((u) => u.id !== id));
    // Also remove any media row that this upload may have added.
    const item = uploads.find((u) => u.id === id);
    if (item?.slot === "media" && item.path) {
      setMedia((m) => m.filter((r) => r.url !== item.path));
    }
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
          if (busyUploads) return toast.error("Wait for uploads to finish");
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
          <input
            type="file"
            accept={IMAGE_TYPES.join(",")}
            onChange={(e) => {
              queueFiles(e.target.files, "image", "cover");
              e.target.value = "";
            }}
            className="text-sm"
          />
          <p className="mt-1 text-[11px] text-muted-foreground">
            JPG, PNG, WEBP, GIF, or AVIF · up to 15 MB.
          </p>
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
          <div className="space-y-3">
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Photos</label>
              <input
                type="file"
                accept={IMAGE_TYPES.join(",")}
                multiple
                onChange={(e) => {
                  queueFiles(e.target.files, "image", "media");
                  e.target.value = "";
                }}
                className="mt-1 block text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                JPG, PNG, WEBP, GIF, or AVIF · up to 15 MB each.
              </p>
            </div>
            <div>
              <label className="text-xs uppercase tracking-widest text-muted-foreground">Videos</label>
              <input
                type="file"
                accept={VIDEO_TYPES.join(",")}
                multiple
                onChange={(e) => {
                  queueFiles(e.target.files, "video", "media");
                  e.target.value = "";
                }}
                className="mt-1 block text-sm"
              />
              <p className="mt-1 text-[11px] text-muted-foreground">
                MP4, WEBM, or MOV · up to 500 MB each.
              </p>
            </div>
            {media.length > 0 && (
              <div className="text-xs text-muted-foreground">
                {media.length} file(s) attached
              </div>
            )}

          </div>
        </Field>

        {uploads.length > 0 && (
          <div className="space-y-2 rounded-md border border-input p-3">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">
              Uploads
            </div>
            <ul className="space-y-3">
              {uploads.map((u) => (
                <UploadRow key={u.id} item={u} onRetry={retry} onCancel={cancel} />
              ))}
            </ul>
          </div>
        )}

        <button
          type="submit"
          disabled={create.isPending || busyUploads}
          className="w-full rounded-md bg-primary px-5 py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] disabled:opacity-50"
        >
          {create.isPending ? "Saving…" : busyUploads ? "Uploading…" : "Publish item"}
        </button>
      </form>
    </section>
  );
}

function UploadRow({
  item,
  onRetry,
  onCancel,
}: {
  item: UploadItem;
  onRetry: (id: string) => void;
  onCancel: (id: string) => void;
}) {
  const pct = item.size > 0 ? Math.min(100, Math.round((item.loaded / item.size) * 100)) : 0;
  const failed = item.status === "error" || item.status === "stalled";
  const barColor =
    item.status === "done"
      ? "bg-primary"
      : failed
      ? "bg-destructive"
      : "bg-primary/70";
  const statusLabel =
    item.status === "uploading"
      ? `${pct}%`
      : item.status === "done"
      ? "Done"
      : item.status === "stalled"
      ? "Stalled"
      : "Failed";

  return (
    <li className="space-y-1">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate">
          <span className="font-medium">{item.name}</span>
          <span className="text-muted-foreground"> · {item.type} · {formatBytes(item.size)}</span>
        </span>
        <span className={failed ? "text-destructive" : "text-muted-foreground"}>
          {statusLabel}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full transition-all ${barColor}`}
          style={{ width: item.status === "done" ? "100%" : `${pct}%` }}
        />
      </div>
      {failed && item.message && (
        <div role="alert" className="text-xs text-destructive">
          {item.message}
        </div>
      )}
      <div className="flex gap-3 text-[10px] uppercase tracking-widest">
        {failed && (
          <button
            type="button"
            onClick={() => onRetry(item.id)}
            className="text-primary underline"
          >
            Retry
          </button>
        )}
        {item.status !== "done" && (
          <button
            type="button"
            onClick={() => onCancel(item.id)}
            className="text-muted-foreground underline"
          >
            Cancel
          </button>
        )}
      </div>
    </li>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="block">
      <div className="mb-1 text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

