import { useEffect, useState } from "react";

const KEY = "age-gate-ok";

export function AgeGate() {
  const [ok, setOk] = useState(true);
  useEffect(() => {
    setOk(typeof window !== "undefined" && localStorage.getItem(KEY) === "1");
  }, []);
  if (ok) return null;
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/95 backdrop-blur-xl px-6">
      <div className="max-w-md w-full rounded-2xl border border-border/70 bg-card p-8 shadow-[var(--shadow-panel)]">
        <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Members only</div>
        <h2 className="mt-3 font-display text-3xl font-semibold">
          You must be <span className="text-neon">18+</span> to enter.
        </h2>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          This site lists private adult events at licensed venues. By entering you
          confirm you are of legal age in your jurisdiction and consent to
          suggestive themes.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={() => { localStorage.setItem(KEY, "1"); setOk(true); }}
            className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition"
          >
            I'm 18 or older — enter
          </button>
          <a
            href="https://www.google.com"
            className="rounded-md border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-secondary/50 transition"
          >
            Leave
          </a>
        </div>
      </div>
    </div>
  );
}
