import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ next: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Sign in · AFTERDARK" },
      { name: "description", content: "Sign in or create an AFTERDARK account." },
    ],
  }),
  component: Auth,
});

function Auth() {
  const search = Route.useSearch();
  const router = useRouter();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);

  const go = () => router.navigate({ to: (search.next as string) || "/" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: window.location.origin,
            data: { display_name: displayName || email.split("@")[0] },
          },
        });
        if (error) throw error;
        toast.success("Welcome. Check your email if confirmation is required.");
        go();
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Welcome back.");
        go();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  async function google() {
    setLoading(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) { toast.error("Google sign-in failed"); setLoading(false); return; }
    if (result.redirected) return;
    go();
  }

  return (
    <section className="mx-auto max-w-md px-5 py-16">
      <div className="rounded-2xl border border-border/70 bg-card p-8 shadow-[var(--shadow-panel)]">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Members</div>
        <h1 className="mt-2 font-display text-3xl font-semibold">
          {mode === "signin" ? "Welcome back." : "Join AFTERDARK."}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {mode === "signin" ? "Sign in to RSVP." : "Create your account to reserve entries."}
        </p>

        <button
          onClick={google}
          disabled={loading}
          className="mt-6 w-full rounded-md border border-border bg-background/50 py-3 text-sm font-medium hover:bg-secondary/50 transition disabled:opacity-50"
        >
          Continue with Google
        </button>

        <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-widest text-muted-foreground">
          <div className="h-px flex-1 bg-border" />or<div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {mode === "signup" && (
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Display name (shown on your RSVPs)"
              className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
            />
          )}
          <input
            type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
          />
          <input
            type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            placeholder="Password (min 8 chars)"
            className="w-full rounded-md border border-input bg-background px-4 py-3 text-sm focus:border-primary focus:outline-none"
          />
          <button
            type="submit" disabled={loading}
            className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:opacity-50"
          >
            {loading ? "…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <button
          onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          className="mt-6 w-full text-center text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          {mode === "signin" ? "New here? Create an account →" : "Already a member? Sign in →"}
        </button>
      </div>
    </section>
  );
}
