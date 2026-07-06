import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { AgeGate } from "@/components/AgeGate";
import { SiteHeader } from "@/components/SiteHeader";
import { AccountBanners } from "@/components/AccountBanners";
import { supabase } from "@/integrations/supabase/client";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-noir px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-7xl font-bold text-neon">404</h1>
        <h2 className="mt-4 font-display text-xl font-semibold">Lost in the dark</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          This door leads nowhere. Try the main floor.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[var(--shadow-glow-pink)]"
          >
            Back to events
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <div className="flex min-h-screen items-center justify-center bg-noir px-4">
      <div className="max-w-md text-center">
        <h1 className="font-display text-xl font-semibold">Something snapped a strap.</h1>
        <p className="mt-2 text-sm text-muted-foreground">Try again in a moment.</p>
        <div className="mt-6 flex justify-center gap-2">
          <button
            onClick={() => { router.invalidate(); reset(); }}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
          >
            Try again
          </button>
          <a href="/" className="rounded-md border border-border px-4 py-2 text-sm">Home</a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Princess Pink — Glory holes, gang bangs & theatre nights" },
      {
        name: "description",
        content:
          "Princess Pink hosts discreet, consent-first adult events — glory hole nights, gang bangs, and adult theatre takeovers. 18+ only.",
      },
      { property: "og:title", content: "Princess Pink — Adult events, hosted with care" },
      {
        property: "og:description",
        content: "Glory holes, gang bangs, and adult theatre takeovers hosted by Princess Pink. 18+ only.",
      },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "Princess Pink" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "theme-color", content: "#0a0a0f" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
    ],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Organization", name: "Princess Pink", url: "https://princesspink90.lovable.app" },
            { "@type": "WebSite", name: "Princess Pink", url: "https://princesspink90.lovable.app" },
          ],
        }),
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="min-h-screen bg-noir">
        <AccountBanners />
        <SiteHeader />
        <Outlet />
        <footer className="border-t border-border/50 mt-24 py-10 text-center text-xs text-muted-foreground">
          <div>PRINCESS PINK · Adults only · 18+ · Consent, safety and discretion are non-negotiable.</div>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
            <Link to="/conduct" className="hover:text-foreground transition">Our Standards</Link>
            <span aria-hidden="true" className="opacity-40">·</span>
            <Link to="/privacy" className="hover:text-foreground transition">Privacy</Link>
          </div>
        </footer>
      </div>
      <AgeGate />
      <Toaster />
    </QueryClientProvider>
  );
}
