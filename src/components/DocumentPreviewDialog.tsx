import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";

type PreviewKind = "pdf" | "image" | "other";

export interface PreviewTarget {
  id: string;
  file_name: string;
  content_type?: string | null;
}

function kindFor(target: PreviewTarget | null): PreviewKind {
  if (!target) return "other";
  const ct = (target.content_type ?? "").toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct === "application/pdf") return "pdf";
  const ext = target.file_name.split(".").pop()?.toLowerCase() ?? "";
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return "image";
  if (ext === "pdf") return "pdf";
  return "other";
}

export function DocumentPreviewDialog({
  target,
  onOpenChange,
  signUrl,
}: {
  target: PreviewTarget | null;
  onOpenChange: (open: boolean) => void;
  signUrl: (id: string) => Promise<string>;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const toastIdRef = useRef<string | number | null>(null);
  const kind = kindFor(target);

  const dismissLoadingToast = useCallback(() => {
    if (toastIdRef.current !== null) {
      toast.dismiss(toastIdRef.current);
      toastIdRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    dismissLoadingToast();
    if (!target) return;
    if (kind === "other") return; // will offer a new-tab fallback

    setLoading(true);
    toastIdRef.current = toast.loading(`Preparing “${target.file_name}”…`);

    signUrl(target.id)
      .then((u) => {
        if (cancelled) return;
        setUrl(u);
        dismissLoadingToast();
      })
      .catch((e) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "Could not load preview";
        setError(msg);
        dismissLoadingToast();
        toast.error(`Preview failed: ${msg}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      dismissLoadingToast();
    };
  }, [target, kind, signUrl, attempt, dismissLoadingToast]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  async function openInNewTab() {
    if (!target) return;
    const toastId = toast.loading(`Preparing download…`);
    try {
      const u = url ?? (await signUrl(target.id));
      toast.dismiss(toastId);
      window.open(u, "_blank", "noopener,noreferrer");
    } catch (e) {
      toast.dismiss(toastId);
      const msg = e instanceof Error ? e.message : "Could not open";
      toast.error(`Download failed: ${msg}`, {
        action: { label: "Retry", onClick: () => openInNewTab() },
      });
    }
  }

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl w-[95vw] p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-4 pb-2">
          <DialogTitle className="truncate pr-8">{target?.file_name ?? "Document"}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center justify-between border-t border-border/60 bg-muted/20 px-5 py-2 text-xs text-muted-foreground">
          <span>
            {kind === "pdf" ? "PDF preview" : kind === "image" ? "Image preview" : "No inline preview available"}
          </span>
          <button
            type="button"
            onClick={openInNewTab}
            className="rounded border border-border/60 px-2 py-1 text-[11px] font-semibold uppercase tracking-widest text-foreground hover:bg-muted/40"
          >
            Open in new tab ↗
          </button>
        </div>
        <div className="bg-background" style={{ height: "min(80vh, 900px)" }}>
          {loading && (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading preview…
            </div>
          )}
          {!loading && error && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
              <p className="text-sm font-medium text-destructive">Preview failed to load</p>
              <p className="max-w-md text-xs text-muted-foreground">{error}</p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={retry}
                  className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
                >
                  Retry
                </button>
                <button
                  type="button"
                  onClick={openInNewTab}
                  className="rounded-md border border-border/60 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground hover:bg-muted/40"
                >
                  Open in new tab
                </button>
              </div>
            </div>
          )}
          {!loading && !error && kind === "pdf" && url && (
            <iframe
              title={target?.file_name ?? "PDF preview"}
              src={url}
              className="h-full w-full"
            />
          )}
          {!loading && !error && kind === "image" && url && (
            <div className="flex h-full w-full items-center justify-center overflow-auto bg-black/60 p-4">
              <img
                src={url}
                alt={target?.file_name ?? ""}
                className="max-h-full max-w-full object-contain"
                onError={() => setError("The file could not be displayed.")}
              />
            </div>
          )}
          {!loading && !error && kind === "other" && (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
              <p>This file type can't be previewed inline.</p>
              <button
                type="button"
                onClick={openInNewTab}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:bg-primary/90"
              >
                Open in new tab
              </button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
