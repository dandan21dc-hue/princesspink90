import { useEffect, useRef, useState } from "react";

/**
 * Live selfie capture (with option to upload instead) for the "hold your ID
 * next to your face" verification step. The parent receives a File.
 */
export function SelfieWithIdCapture({
  onCapture,
  file,
  onClear,
}: {
  onCapture: (file: File) => void;
  file: File | null;
  onClear: () => void;
}) {
  const [mode, setMode] = useState<"idle" | "camera">("idle");
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrl = file ? URL.createObjectURL(file) : null;

  useEffect(() => {
    if (mode !== "camera") return;
    let cancelled = false;
    setReady(false);
    setError(null);
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
          setReady(true);
        }
      } catch (e) {
        setError(
          e instanceof Error
            ? e.message
            : "Couldn't access the camera. Grant permission or upload a photo instead.",
        );
      }
    })();
    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [mode, facing]);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !ready) return;
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth;
    canvas.height = v.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(v, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const f = new File([blob], `selfie-${Date.now()}.jpg`, { type: "image/jpeg" });
        onCapture(f);
        setMode("idle");
      },
      "image/jpeg",
      0.9,
    );
  };

  if (file && previewUrl) {
    return (
      <div className="space-y-2">
        <div className="overflow-hidden rounded-xl border border-neon/40">
          <img src={previewUrl} alt="Selfie holding ID" className="w-full object-cover" />
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-border px-3 py-1.5 text-[11px] font-semibold uppercase tracking-widest hover:bg-accent"
          >
            Retake
          </button>
          <span className="self-center text-[11px] text-muted-foreground">
            Hold your ID next to your face, both fully visible and readable.
          </span>
        </div>
      </div>
    );
  }

  if (mode === "camera") {
    return (
      <div className="overflow-hidden rounded-xl border border-neon/40 bg-black">
        <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-neon">
            <span className={`h-2 w-2 rounded-full ${ready ? "animate-pulse bg-neon" : "bg-neon/40"}`} />
            {ready ? "Camera live — line up ID beside your face" : "Starting camera…"}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setFacing((f) => (f === "user" ? "environment" : "user"))}
              className="rounded-md border border-white/30 px-2 py-1 text-[10px] uppercase tracking-widest text-white/80 hover:bg-white/10"
            >
              ⇆ {facing === "user" ? "Front" : "Back"}
            </button>
            <button
              type="button"
              onClick={() => setMode("idle")}
              className="text-[10px] uppercase tracking-widest text-white/70 hover:text-white"
            >
              Cancel ✕
            </button>
          </div>
        </div>
        <div className="relative aspect-[4/3] w-full">
          <video ref={videoRef} className="h-full w-full object-cover" muted playsInline />
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4 text-center text-xs text-destructive">
              {error}
            </div>
          )}
        </div>
        <div className="flex items-center justify-center gap-3 border-t border-white/10 bg-black px-3 py-3">
          <button
            type="button"
            onClick={shoot}
            disabled={!ready}
            className="rounded-full bg-primary px-6 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground disabled:opacity-40"
          >
            ● Capture
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => setMode("camera")}
        className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground"
      >
        ◉ Open camera
      </button>
      <label className="cursor-pointer rounded-md border border-border px-4 py-2 text-xs font-semibold uppercase tracking-widest hover:bg-accent">
        Upload photo
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onCapture(f);
          }}
        />
      </label>
    </div>
  );
}
