import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { marked } from "marked";

const MD_URL = "/security/security-findings-summary.md";
const PDF_URL = "/security/security-findings-summary.pdf";

// Configure marked once for GFM + line breaks; sanitize is not needed because
// the source markdown is a checked-in file we author, not user input.
marked.setOptions({ gfm: true, breaks: false });

const reportQueryOptions = {
  queryKey: ["security-report-md"] as const,
  queryFn: async () => {
    const res = await fetch(MD_URL, { headers: { Accept: "text/markdown" } });
    if (!res.ok) throw new Error(`Failed to load security report (${res.status})`);
    const md = await res.text();
    const html = marked.parse(md) as string;
    return { md, html };
  },
  staleTime: 5 * 60 * 1000,
  // Client-only: the file lives in /public and there's no absolute URL
  // available during SSR/prerender. Rendering the shell server-side and
  // hydrating the body is fine for a rarely-visited share page.
  enabled: typeof window !== "undefined",
};


export const Route = createFileRoute("/security-report")({
  head: () => ({
    meta: [
      { title: "Security Findings Summary — Princess Pink" },
      {
        name: "description",
        content:
          "Concise before/after report of resolved security findings, mitigations, accepted advisories, and regression prevention.",
      },
      { property: "og:title", content: "Security Findings Summary" },
      {
        property: "og:description",
        content:
          "Fixes, mitigations, and accepted advisories from the latest security triage — Markdown and PDF downloads.",
      },
      { property: "og:type", content: "article" },
      {
        property: "og:url",
        content: "https://princesspink90.lovable.app/security-report",
      },
      // Don't index the security report by default — it's meant to be shared
      // via a direct link, not surfaced in search results.
      { name: "robots", content: "noindex,follow" },
    ],
    links: [
      { rel: "canonical", href: "https://princesspink90.lovable.app/security-report" },
    ],
  }),
  loader: () => null,
  component: SecurityReportPage,
  errorComponent: SecurityReportError,
});

function SecurityReportPage() {
  const { data, error } = useQuery(reportQueryOptions);


  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 bg-gradient-to-b from-primary/5 to-transparent">
        <div className="mx-auto max-w-3xl px-5 pt-16 pb-12">
          <Link
            to="/"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Home
          </Link>
          <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">
            Security
          </div>
          <h1 className="mt-2 font-display text-4xl font-extrabold">
            Security findings summary
          </h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Before/after notes for the resolved findings, mitigations, accepted
            advisories, and regression-prevention tooling. Share this page or
            download the report below.
          </p>

          <div className="mt-6 flex flex-wrap gap-3">
            <a
              href={PDF_URL}
              download
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
            >
              Download PDF
            </a>
            <a
              href={MD_URL}
              download
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              Download Markdown
            </a>
            <a
              href={PDF_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-muted"
            >
              Open PDF in new tab
            </a>
          </div>
        </div>
      </header>

      <article className="mx-auto max-w-3xl px-5 py-12">
        {error ? (
          <p className="text-sm text-destructive">
            Couldn't render the inline report. Use the download buttons above.
          </p>
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Loading report…</p>
        ) : (
          <div
            className="prose prose-invert max-w-none prose-headings:font-display prose-headings:font-bold prose-h1:text-3xl prose-h2:mt-10 prose-h2:text-2xl prose-h3:text-xl prose-a:text-primary prose-code:rounded prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-muted"
            // Source is an author-controlled markdown file in public/, not user input.
            dangerouslySetInnerHTML={{ __html: data.html }}
          />
        )}
      </article>

    </main>
  );
}

function SecurityReportError({ error }: { error: Error }) {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <Link to="/" className="text-xs uppercase tracking-widest text-muted-foreground">
        ← Home
      </Link>
      <h1 className="mt-4 font-display text-3xl font-bold">
        Security report unavailable
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        We couldn't load the report right now.{" "}
        <a href={PDF_URL} className="text-primary underline">
          Try the PDF directly
        </a>
        .
      </p>
      <pre className="mt-6 overflow-auto rounded bg-muted p-3 text-xs">
        {error.message}
      </pre>
    </main>
  );
}
