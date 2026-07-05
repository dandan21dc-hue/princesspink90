import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { searchEmailByRecipient } from "@/lib/email-recipient-search.functions";

export const Route = createFileRoute(
  "/_authenticated/admin/email-recipient-search",
)({
  head: () => ({
    meta: [
      { title: "Email recipient search — Admin" },
      {
        name: "description",
        content:
          "Search the email send log by recipient. Recipients display masked; results include template, send status, resend id, and suppression state.",
      },
    ],
  }),
  component: AdminEmailRecipientSearchPage,
});

const STATUS_STYLES: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-400",
  sent: "bg-emerald-500/15 text-emerald-400",
  suppressed: "bg-muted/40 text-foreground/70",
  failed: "bg-destructive/15 text-destructive",
  dlq: "bg-destructive/15 text-destructive",
  bounced: "bg-destructive/15 text-destructive",
  complained: "bg-destructive/15 text-destructive",
};

function AdminEmailRecipientSearchPage() {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState("");
  const fn = useServerFn(searchEmailByRecipient);

  const query = useQuery({
    queryKey: ["admin-email-recipient-search", submitted],
    queryFn: () => fn({ data: { query: submitted, limit: 100 } }),
    enabled: submitted.length > 0,
  });

  const rows = query.data?.rows ?? [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">
          Admin
        </div>
        <h1 className="mt-2 font-display text-3xl font-semibold">
          Email recipient search
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Search the email send log by recipient address (full or partial).
          Recipients are masked in the results; resend id and suppression state
          are shown alongside template and send status.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-8">
        <form
          className="flex flex-col gap-3 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            setSubmitted(input.trim());
          }}
        >
          <input
            type="search"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="alice@example.com or example.com"
            aria-label="Recipient email or domain"
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/60"
          />
          <button
            type="submit"
            disabled={!input.trim()}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            Search
          </button>
        </form>
        {submitted && query.data && (
          <p className="mt-3 text-xs text-muted-foreground">
            {query.data.rows.length} shown · {query.data.total_matches} total
            matching messages · {query.data.unique_recipients} distinct
            recipients
          </p>
        )}
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-24">
        {!submitted && (
          <p className="text-sm text-muted-foreground">
            Enter a recipient to search.
          </p>
        )}
        {query.isLoading && (
          <p className="text-sm text-muted-foreground">Searching…</p>
        )}
        {query.error && (
          <p className="text-sm text-destructive">
            {(query.error as Error).message}
          </p>
        )}
        {submitted && !query.isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No matching emails.</p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/30 text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Recipient (masked)</th>
                  <th className="px-3 py-2 text-left">Template</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="px-3 py-2 text-left">Suppression</th>
                  <th className="px-3 py-2 text-left">Resend id</th>
                  <th className="px-3 py-2 text-left">Sent</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-border align-top"
                  >
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.recipient_masked}
                    </td>
                    <td className="px-3 py-2">
                      {r.template_name ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[r.status] ??
                          "bg-muted/40 text-foreground/70"
                        }`}
                      >
                        {r.status}
                      </span>
                      {r.error_message && (
                        <div className="mt-1 text-xs text-destructive">
                          {r.error_message}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {r.suppressed ? (
                        <span className="inline-flex rounded bg-destructive/15 px-2 py-0.5 font-medium text-destructive">
                          suppressed
                          {r.suppressed_reason
                            ? ` · ${r.suppressed_reason}`
                            : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">active</span>
                      )}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {r.resend_message_id ?? (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
