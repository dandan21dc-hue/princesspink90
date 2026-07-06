import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { checkAgeGate } from "@/lib/account.functions";

const KEY = "age-gate-ok";

function logAgeGateEvent(outcome: "viewed" | "confirmed" | "declined", context: "anonymous" | "authenticated") {
  try {
    const body = JSON.stringify({
      outcome,
      context,
      path: typeof window !== "undefined" ? window.location.pathname : undefined,
    });
    const url = "/api/public/age-gate-event";
    if (typeof navigator !== "undefined" && "sendBeacon" in navigator) {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(url, blob)) return;
    }
    void fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* best-effort audit log */
  }
}


/**
 * Two-layer age gate:
 * - Signed-in users: server-recorded confirmation. If missing, redirect to
 *   the /age-gate page. `_authenticated` also runs this check server-side
 *   before rendering; this component covers public routes (/store, /) when
 *   the user happens to be signed in.
 * - Anonymous visitors: localStorage prompt (marketing-page friendly).
 */
export function AgeGate() {
  const [ok, setOk] = useState(true);
  const [signedInChecked, setSignedInChecked] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    (async () => {
      const { data: userRes } = await supabase.auth.getUser();
      if (!alive) return;
      if (userRes.user) {
        // Signed in — defer to server-recorded confirmation.
        try {
          const gate = await checkAgeGate();
          if (!alive) return;
          if (!gate.confirmed && !location.pathname.startsWith("/age-gate") && !location.pathname.startsWith("/auth")) {
            navigate({ to: "/age-gate", search: { next: location.href } });
            return;
          }
          setOk(true);
        } catch {
          // If the check fails (network, etc.) don't hard-lock the user.
          setOk(true);
        } finally {
          setSignedInChecked(true);
        }
      } else {
        // Anonymous — localStorage prompt.
        const stored = typeof window !== "undefined" && localStorage.getItem(KEY) === "1";
        setOk(stored);
        setSignedInChecked(true);
      }
    })();
    return () => { alive = false; };
  }, [location.pathname, navigate]);

  if (ok || !signedInChecked) return null;
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
