import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { z } from "zod";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { toast } from "sonner";
import { validateReferralCode } from "@/lib/referral-validate.functions";

export const Route = createFileRoute("/auth")({
  validateSearch: z.object({ next: z.string().optional(), ref: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "Sign in · Midnight Glory" },
      {
        name: "description",
        content:
          "Sign in or create your Midnight Glory account to RSVP for events, manage memberships, and unlock the full library.",
      },
      { property: "og:title", content: "Sign in · Midnight Glory" },
      {
        property: "og:description",
        content:
          "Sign in or create your Midnight Glory account to RSVP for events and manage memberships.",
      },
      { name: "robots", content: "noindex,follow" },
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
  const [referralCode, setReferralCode] = useState(
    typeof search.ref === "string" ? search.ref.toUpperCase().trim().slice(0, 12) : "",
  );
  const [loading, setLoading] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [refStatus, setRefStatus] = useState<
    { state: "idle" | "checking" | "ok" | "invalid" | "self"; message: string }
  >({ state: "idle", message: "" });
  const runValidate = useServerFn(validateReferralCode);

  useEffect(() => {
    if (mode !== "signup") {
      setRefStatus({ state: "idle", message: "" });
      return;
    }
    const code = referralCode.trim().toUpperCase();
    if (!code) {
      setRefStatus({ state: "idle", message: "" });
      return;
    }
    let cancelled = false;
    setRefStatus({ state: "checking", message: "Checking code…" });
    const t = setTimeout(async () => {
      try {
        const res = await runValidate({ data: { code, email } });
        if (cancelled) return;
        if (!res.exists) {
          setRefStatus({ state: "invalid", message: "That referral code doesn't exist." });
        } else if (res.is_self) {
          setRefStatus({
            state: "self",
            message: "You can't use your own referral code.",
          });
        } else {
          setRefStatus({ state: "ok", message: "Referral code applied." });
        }
      } catch {
        if (!cancelled) setRefStatus({ state: "idle", message: "" });
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [referralCode, email, mode, runValidate]);

  // Only accept same-origin relative paths for `next` so OAuth consent returns work
  // without opening an open-redirect.
  const nextParam =
    typeof search.next === "string" && search.next.startsWith("/") && !search.next.startsWith("//")
      ? search.next
      : "";
  const returnTo =
    typeof window !== "undefined"
      ? window.location.origin + (nextParam || "/")
      : nextParam || "/";

  const go = () => router.navigate({ to: nextParam || "/" });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "signup" && !agreedToTerms) {
      toast.error("Please agree to the Terms of Service and Privacy Policy.");
      return;
    }
    setLoading(true);
    try {
      if (mode === "signup") {
        const trimmedRef = referralCode.trim().toUpperCase();
        if (trimmedRef) {
          const res = await runValidate({ data: { code: trimmedRef, email } });
          if (!res.exists) {
            setRefStatus({ state: "invalid", message: "That referral code doesn't exist." });
            toast.error("That referral code doesn't exist.");
            setLoading(false);
            return;
          }
          if (res.is_self) {
            setRefStatus({ state: "self", message: "You can't use your own referral code." });
            toast.error("You can't use your own referral code.");
            setLoading(false);
            return;
          }
        }
        const { error } = await supabase.auth.signUp({
          email, password,
          options: {
            emailRedirectTo: returnTo,
            data: {
              display_name: displayName || email.split("@")[0],
              ...(trimmedRef ? { referral_code: trimmedRef } : {}),
            },
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
      redirect_uri: returnTo,
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
          {mode === "signup" && (
            <div>
              <input
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value.toUpperCase().slice(0, 12))}
                placeholder="Referral code (optional)"
                autoCapitalize="characters"
                aria-invalid={refStatus.state === "invalid" || refStatus.state === "self"}
                className={`w-full rounded-md border bg-background px-4 py-3 text-sm font-mono tracking-widest uppercase focus:outline-none ${
                  refStatus.state === "invalid" || refStatus.state === "self"
                    ? "border-destructive focus:border-destructive"
                    : refStatus.state === "ok"
                      ? "border-primary focus:border-primary"
                      : "border-input focus:border-primary"
                }`}
              />
              {refStatus.message ? (
                <p
                  className={`mt-1 text-xs ${
                    refStatus.state === "invalid" || refStatus.state === "self"
                      ? "text-destructive"
                      : refStatus.state === "ok"
                        ? "text-primary"
                        : "text-muted-foreground"
                  }`}
                  role={refStatus.state === "invalid" || refStatus.state === "self" ? "alert" : undefined}
                >
                  {refStatus.message}
                </p>
              ) : null}
            </div>
          )}
          {mode === "signup" && (
            <label className="flex items-start gap-2 pt-1 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={agreedToTerms}
                onChange={(e) => setAgreedToTerms(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-primary"
              />
              <span>
                I agree to the{" "}
                <Link to="/terms" target="_blank" className="text-primary underline">
                  Terms of Service
                </Link>{" "}
                and{" "}
                <Link to="/privacy" target="_blank" className="text-primary underline">
                  Privacy Policy
                </Link>
                .
              </span>
            </label>
          )}
          <button
            type="submit" disabled={loading || (mode === "signup" && !agreedToTerms)}
            className="w-full rounded-md bg-primary py-3 text-sm font-semibold uppercase tracking-widest text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition disabled:cursor-not-allowed disabled:opacity-50"
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
        {mode === "signin" && (
          <Link
            to="/forgot-password"
            className="mt-3 block text-center text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            Forgot password?
          </Link>
        )}
      </div>
    </section>
  );
}
