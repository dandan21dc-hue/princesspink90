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
  const [cameras, setCameras] = useState<{ id: string; label: string }[]>([]);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [hasTorch, setHasTorch] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

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
        preferredCamera: facing,
        maxScansPerSecond: 5,
      },
    );
    scannerRef.current = scanner;

    scanner
      .start()
      .then(async () => {
        if (cancelled) return;
        setReady(true);
        try {
          const list = await QrScanner.listCameras(true);
          if (!cancelled) setCameras(list.map((c) => ({ id: c.id, label: c.label })));
        } catch { /* ignore */ }
        try {
          const flash = await scanner.hasFlash();
          if (!cancelled) {
            setHasTorch(flash);
            setTorchOn(scanner.isFlashOn());
          }
        } catch { /* ignore */ }
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
  }, [onScan, facing]);

  const toggleTorch = async () => {
    const s = scannerRef.current;
    if (!s) return;
    try {
      if (torchOn) {
        await s.turnFlashOff();
        setTorchOn(false);
      } else {
        await s.turnFlashOn();
        setTorchOn(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Torch unavailable on this camera.");
    }
  };

  const switchFacing = () => {
    setReady(false);
    setTorchOn(false);
    setHasTorch(false);
    setFacing((f) => (f === "environment" ? "user" : "environment"));
  };

  const pickCamera = async (id: string) => {
    const s = scannerRef.current;
    if (!s) return;
    setReady(false);
    setTorchOn(false);
    setHasTorch(false);
    try {
      await s.setCamera(id);
      setReady(true);
      const flash = await s.hasFlash();
      setHasTorch(flash);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't switch camera.");
    }
  };


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
        <div className="flex items-center gap-2">
          {hasTorch && (
            <button
              onClick={toggleTorch}
              className={`rounded-md border px-2 py-1 text-[10px] uppercase tracking-widest transition ${
                torchOn
                  ? "border-neon bg-neon/20 text-neon"
                  : "border-white/30 text-white/80 hover:bg-white/10"
              }`}
              aria-pressed={torchOn}
              title="Toggle torch"
            >
              {torchOn ? "🔦 Torch on" : "🔦 Torch"}
            </button>
          )}
          {cameras.length > 1 && (
            <button
              onClick={switchFacing}
              className="rounded-md border border-white/30 px-2 py-1 text-[10px] uppercase tracking-widest text-white/80 hover:bg-white/10"
              title="Swap front/back camera"
            >
              ⇆ {facing === "environment" ? "Back" : "Front"}
            </button>
          )}
          {cameras.length > 2 && (
            <select
              onChange={(e) => pickCamera(e.target.value)}
              className="max-w-[9rem] rounded-md border border-white/30 bg-black px-1.5 py-1 text-[10px] uppercase tracking-widest text-white/80"
              defaultValue=""
              title="Pick a specific camera"
            >
              <option value="" disabled>
                Camera…
              </option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label || c.id.slice(0, 8)}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={onClose}
            className="text-[10px] uppercase tracking-widest text-white/70 hover:text-white"
          >
            Close ✕
          </button>
        </div>

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

