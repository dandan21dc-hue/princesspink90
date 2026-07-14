import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Set a new password · AFTERDARK" },
      { name: "description", content: "Choose a new password for your account." },
    ],
  }),
  component: ResetPassword,
});

function ResetPassword() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Supabase places a recovery token in the URL hash and triggers a
    // PASSWORD_RECOVERY auth event once it exchanges the token for a session.
    let cancelled = false;
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === "PASSWORD_RECOVERY" || session) {
        setHasSession(true);
        setReady(true);
      }
    });
    // Also check for an already-exchanged session on mount.
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) setHasSession(true);
      setReady(true);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 8) {
      toast.error("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      toast.error("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated. You're signed in.");
      router.navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not update password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-2xl border border-border/70 bg-card p-8 shadow-[var(--shadow-panel)]">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Password reset</div>
        <h1 className="mt-2 font-display text-3xl font-semibold">Set a new password</h1>

        {!ready ? (
          <p className="mt-6 text-sm text-muted-foreground">Verifying reset link…</p>
        ) : !hasSession ? (
          <div className="mt-6 space-y-3">
            <p className="text-sm text-muted-foreground">
              This reset link is invalid or has expired. Request a new one to continue.
            </p>
            <button
              onClick={() => router.navigate({ to: "/forgot-password" })}
              className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition"
            >
              Request new link
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="New password (min 8 chars)"
              className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
            />
            <input
              type="password"
              required
              minLength={8}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder="Confirm new password"
              className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Saving…" : "Update password"}
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
