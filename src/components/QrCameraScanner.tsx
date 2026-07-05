import { useEffect, useRef, useState } from "react";
import QrScanner from "qr-scanner";

export type ScanFeedback = {
  tone: "ok" | "warn" | "err";
  title: string;
  detail?: string;
} | null;

/**
 * Live camera QR scanner. Calls `onScan` with the decoded text.
 * The parent controls the guard against duplicate scans of the same code
 * and passes back a `feedback` banner so the operator sees clear
 * per-scan messages without leaving camera mode.
 */
export function QrCameraScanner({
  onScan,
  onClose,
  feedback,
}: {
  onScan: (text: string) => void;
  onClose: () => void;
  feedback?: ScanFeedback;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<QrScanner | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let cancelled = false;

    const scanner = new QrScanner(
      video,
      (r) => onScan(r.data),
      {
        highlightScanRegion: true,
        highlightCodeOutline: true,
        preferredCamera: "environment",
        maxScansPerSecond: 5,
      },
    );
    scannerRef.current = scanner;

    scanner
      .start()
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setError(
            e instanceof Error
              ? e.message
              : "Couldn't access the camera. Grant permission and try again.",
          );
      });

    return () => {
      cancelled = true;
      scanner.stop();
      scanner.destroy();
      scannerRef.current = null;
    };
  }, [onScan]);

  const toneCls =
    feedback?.tone === "ok"
      ? "border-neon/60 bg-neon/15 text-neon"
      : feedback?.tone === "warn"
      ? "border-primary/60 bg-primary/15 text-primary"
      : "border-destructive/60 bg-destructive/20 text-destructive";

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-neon/40 bg-black">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-neon">
          <span
            className={`h-2 w-2 rounded-full ${ready ? "animate-pulse bg-neon" : "bg-neon/40"}`}
          />
          {ready
            ? feedback
              ? "Camera live — ready for next scan"
              : "Camera live — point at QR"
            : "Starting camera…"}
        </div>
        <button
          onClick={onClose}
          className="text-[10px] uppercase tracking-widest text-white/70 hover:text-white"
        >
          Close ✕
        </button>
      </div>
      <div className="relative aspect-square w-full">
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-xs text-destructive">
            {error}
          </div>
        )}
        {feedback && !error && (
          <div
            className={`pointer-events-none absolute inset-x-3 bottom-3 rounded-lg border px-3 py-2 text-xs backdrop-blur ${toneCls}`}
            role="status"
            aria-live="polite"
          >
            <div className="font-semibold uppercase tracking-widest">{feedback.title}</div>
            {feedback.detail && (
              <div className="mt-0.5 text-[11px] normal-case tracking-normal opacity-90">
                {feedback.detail}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

