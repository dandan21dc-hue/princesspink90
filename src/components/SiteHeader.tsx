import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export function SiteHeader() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthed(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setAuthed(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
    router.navigate({ to: "/" });
  }

  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Link to="/" className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-primary shadow-[var(--shadow-glow-pink)] animate-neon" />
          <span className="font-display text-lg font-semibold tracking-tight">
            AFTER<span className="text-neon">DARK</span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 text-sm">
          <Link
            to="/"
            className="px-3 py-2 text-muted-foreground hover:text-foreground transition"
            activeProps={{ className: "px-3 py-2 text-foreground" }}
          >
            Events
          </Link>
          <Link
            to="/unlock"
            className="px-3 py-2 text-muted-foreground hover:text-foreground transition"
          >
            Private code
          </Link>
          {authed ? (
            <>
              <Link
                to="/dashboard"
                className="px-3 py-2 text-muted-foreground hover:text-foreground transition"
              >
                Dashboard
              </Link>
              <button
                onClick={signOut}
                className="ml-2 rounded-md border border-border px-3 py-2 text-xs uppercase tracking-wider hover:bg-secondary/50 transition"
              >
                Sign out
              </button>
            </>
          ) : authed === false ? (
            <Link
              to="/auth"
              className="ml-2 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-wider text-primary-foreground shadow-[var(--shadow-glow-pink)] hover:brightness-110 transition"
            >
              Sign in
            </Link>
          ) : null}
        </nav>
      </div>
    </header>
  );
}
