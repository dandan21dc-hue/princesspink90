import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset password · Midnight Glory" },
      {
        name: "description",
        content:
          "Request a secure password reset link for your Midnight Glory account. We'll email you a one-time link to set a new password.",
      },
      { property: "og:title", content: "Reset password · Midnight Glory" },
      {
        property: "og:description",
        content:
          "Request a secure password reset link for your Midnight Glory account.",
      },
      { name: "robots", content: "noindex,follow" },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/reset-password`
          : "/reset-password";
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setSent(true);
      toast.success("If that email exists, a reset link has been sent.");
    } catch (err) {
      // Do not leak account existence — always show generic success.
      setSent(true);
      toast.success("If that email exists, a reset link has been sent.");
      console.error(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-2xl border border-border/70 bg-card p-8 shadow-[var(--shadow-panel)]">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Password reset</div>
        <h1 className="mt-2 font-display text-3xl font-semibold">Forgot your password?</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Enter your account email and we'll send you a secure link to set a new password.
        </p>

        {sent ? (
          <div className="mt-6 space-y-4">
            <div className="rounded-md border border-border bg-background/50 p-4 text-sm">
              Check your inbox for a reset link. It expires shortly for your security.
            </div>
            <Link
              to="/auth"
              className="block text-center text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              ← Back to sign in
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="mt-6 space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send reset link"}
            </button>
            <Link
              to="/auth"
              className="block pt-2 text-center text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              ← Back to sign in
            </Link>
          </form>
        )}
      </div>
    </section>
  );
}
