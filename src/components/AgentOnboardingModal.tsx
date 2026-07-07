import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

const STORAGE_KEY = "princess-pink:agent-onboarding:v1";

const STEPS = [
  {
    title: "Welcome to Princess Pink",
    body: "This app can also plug into AI assistants like ChatGPT and Claude — so they can look up venue info and file partnership inquiries for you.",
  },
  {
    title: "Grab the MCP URL",
    body: "Head to the Connect page. You'll see a one-line server URL, a copy button, and a live status check to confirm it's reachable.",
  },
  {
    title: "Add it to your assistant",
    body: "Paste the URL into ChatGPT's or Claude's custom-connector dialog. The Connect page has click-by-click instructions and a troubleshooting section for common errors.",
  },
];

export function AgentOnboardingModal() {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    try {
      if (!window.localStorage.getItem(STORAGE_KEY)) {
        // Delay one tick so it doesn't fight the age gate on first paint.
        const t = window.setTimeout(() => setOpen(true), 400);
        return () => window.clearTimeout(t);
      }
    } catch {
      /* ignore */
    }
  }, []);

  function dismiss() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      /* ignore */
    }
    setOpen(false);
  }

  if (!open) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-onboarding-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 px-4 backdrop-blur-sm"
    >
      <div className="w-full max-w-lg rounded-3xl border border-primary/40 bg-card p-6 shadow-[var(--shadow-glow-pink)] sm:p-8">
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.3em] text-neon">
            Agent integrations
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:text-foreground transition"
          >
            ✕
          </button>
        </div>

        <h2
          id="agent-onboarding-title"
          className="mt-3 font-display text-2xl font-bold sm:text-3xl"
        >
          {current.title}
        </h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {current.body}
        </p>

        <div className="mt-6 flex items-center gap-2">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition ${
                i <= step ? "bg-neon" : "bg-border"
              }`}
              aria-hidden
            />
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            onClick={dismiss}
            className="text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition"
          >
            Skip
          </button>
          <div className="flex gap-2">
            {step > 0 && (
              <button
                type="button"
                onClick={() => setStep((s) => s - 1)}
                className="rounded-md border border-border px-4 py-2 text-xs uppercase tracking-wider hover:bg-secondary/50 transition"
              >
                Back
              </button>
            )}
            {isLast ? (
              <Link
                to="/connect"
                onClick={dismiss}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground shadow-[var(--shadow-glow-pink)]"
              >
                Open Connect page
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setStep((s) => s + 1)}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground shadow-[var(--shadow-glow-pink)]"
              >
                Next
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
