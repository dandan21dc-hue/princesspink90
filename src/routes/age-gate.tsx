import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { confirmAgeGate } from "@/lib/account.functions";

export const Route = createFileRoute("/age-gate")({
  ssr: false,
  validateSearch: (search: Record<string, unknown>) => ({
    next: typeof search.next === "string" ? search.next : "/",
  }),
  head: () => ({
    meta: [
      { title: "18+ confirmation — Princess Pink" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AgeGatePage,
});

function AgeGatePage() {
  const { next } = Route.useSearch();
  const navigate = useNavigate();
  const confirm = useServerFn(confirmAgeGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onConfirm() {
    setBusy(true);
    setError(null);
    try {
      const result = await confirm();
      if ("error" in result) throw new Error(result.error);
      try { localStorage.setItem("age-gate-ok", "1"); } catch { /* ignore */ }
      // Only allow same-origin redirects; otherwise home.
      let dest = "/";
      try {
        const url = new URL(next, window.location.origin);
        if (url.origin === window.location.origin) dest = url.pathname + url.search + url.hash;
      } catch { /* ignore */ }
      navigate({ to: dest });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save confirmation");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-6">
      <div className="max-w-md w-full rounded-2xl border border-border/70 bg-card p-8 shadow-[var(--shadow-panel)]">
        <div className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Members only</div>
        <h1 className="mt-3 font-display text-3xl font-semibold">
          Confirm you are <span className="text-neon">18 or older</span>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
          This site contains adult content. By continuing you confirm you are
          of legal age in your jurisdiction and consent to explicit and
          suggestive themes. We record this confirmation against your account.
        </p>
        {error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
        <div className="mt-6 flex gap-3">
          <button
            disabled={busy}
            onClick={onConfirm}
            className="flex-1 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:opacity-60"
          >
            {busy ? "Saving…" : "I'm 18 or older — enter"}
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
