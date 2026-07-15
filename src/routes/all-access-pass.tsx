import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { PaymentTestModeBanner } from "@/components/PaymentTestModeBanner";
import { AllAccessCard } from "@/components/AllAccessCard";

export const Route = createFileRoute("/all-access-pass")({
  head: () => ({
    meta: [
      { title: "All-Access Pass — Midnight Glory" },
      {
        name: "description",
        content:
          "Unlock everything Midnight Glory — monthly, term, or lifetime plans. Full library access to photo sets, videos, and bundles.",
      },
      { property: "og:title", content: "All-Access Pass · Midnight Glory" },
      {
        property: "og:description",
        content: "Choose monthly, 3/6/12-month, or lifetime access to the full library.",
      },
      { property: "og:url", content: "https://princesspink90.com/all-access-pass" },
    ],
    links: [{ rel: "canonical", href: "https://princesspink90.com/all-access-pass" }],
  }),
  component: AllAccessPassPage,
  pendingComponent: PagePending,
  errorComponent: PageError,
  notFoundComponent: PageNotFound,
});

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PaymentTestModeBanner />
      <section className="mx-auto max-w-5xl px-5 pt-10 pb-16">
        <div className="text-xs uppercase tracking-[0.3em] text-primary">Membership</div>
        <h1 className="mt-2 font-display text-4xl font-extrabold sm:text-5xl">
          The <span className="text-neon">All-Access Pass</span>
        </h1>
        {children}
        <div className="mt-10 text-xs text-muted-foreground">
          <Link to="/store" className="underline hover:text-primary">
            ← Back to store
          </Link>
        </div>
      </section>
    </>
  );
}

function PagePending() {
  return (
    <PageShell>
      <div className="mt-8 space-y-4" role="status" aria-live="polite" aria-busy="true">
        <div className="h-6 w-2/3 animate-pulse rounded-md bg-muted/40" />
        <div className="h-64 animate-pulse rounded-2xl bg-muted/30" />
        <span className="sr-only">Loading membership options…</span>
      </div>
    </PageShell>
  );
}

function PageError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  return (
    <PageShell>
      <div
        role="alert"
        className="mt-8 rounded-2xl border border-destructive/40 bg-destructive/5 p-6"
      >
        <div className="text-xs uppercase tracking-[0.3em] text-destructive">
          Couldn't load memberships
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {error?.message ?? "Something went wrong while loading plans."}
        </p>
        <button
          type="button"
          onClick={() => {
            reset();
            void router.invalidate();
          }}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground hover:brightness-110"
        >
          Try again
        </button>
      </div>
    </PageShell>
  );
}

function PageNotFound() {
  return (
    <PageShell>
      <p className="mt-8 text-sm text-muted-foreground">This page could not be found.</p>
    </PageShell>
  );
}

function AllAccessPassPage() {
  return (
    <PageShell>
      <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
        One pass, the whole library — every photo set, video, and bundle. Pick the
        rhythm that suits you: monthly, term, or lifetime.
      </p>
      <div className="mt-8">
        <AllAccessCard />
      </div>
    </PageShell>
  );
}
