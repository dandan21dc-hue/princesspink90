import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { amIAdmin } from "@/lib/admin.functions";
import { listConsentSubmissions } from "@/lib/consent-review.functions";

export const Route = createFileRoute("/_authenticated/admin/consent-review")({
  head: () => ({
    meta: [
      { title: "Consent review — Admin" },
      {
        name: "description",
        content:
          "Admin-only review of consent submissions: policy agreements and waiver audit entries.",
      },
    ],
  }),
  component: AdminConsentReview,
});

function AdminConsentReview() {
  const [kind, setKind] = useState<"all" | "policy_agreement" | "waiver">("all");

  const meFn = useServerFn(amIAdmin);
  const listFn = useServerFn(listConsentSubmissions);

  const me = useQuery({ queryKey: ["am-i-admin"], queryFn: () => meFn() });
  const isAdmin = me.data?.isAdmin === true;

  const q = useQuery({
    queryKey: ["admin-consent-review", kind],
    queryFn: () => listFn({ data: { kind, limit: 300 } }),
    enabled: isAdmin,
  });

  if (me.isLoading) {
    return (
      <div className="min-h-screen bg-background p-8 text-sm text-muted-foreground">
        Checking access…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background p-8">
        <div className="mx-auto max-w-lg rounded-2xl border border-destructive/40 bg-destructive/10 p-6 text-sm text-destructive">
          Admin access required. This page is restricted to administrators.
        </div>
      </div>
    );
  }

  const rows = q.data ?? [];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto max-w-5xl px-5 pt-16 pb-8">
        <Link
          to="/dashboard"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Dashboard
        </Link>
        <div className="mt-6 text-xs uppercase tracking-[0.3em] text-primary">Admin</div>
        <h1 className="mt-2 font-display text-3xl font-semibold">Consent review</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Every consent submission recorded in the database: policy agreements
          and waiver audit entries. Access is restricted to administrators and
          enforced by the same row-level rules the database uses.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">Kind</div>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All submissions</option>
              <option value="policy_agreement">Policy agreements</option>
              <option value="waiver">Waivers</option>
            </select>
          </label>
          <div className="ml-auto text-xs text-muted-foreground">
            {q.isLoading ? "Loading…" : `${rows.length} entries`}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        {q.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {q.error instanceof Error ? q.error.message : "Failed to load consent submissions"}
          </div>
        )}
        {!q.isLoading && rows.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No consent submissions to display.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Policy</th>
                  <th className="px-4 py-3">Action / metadata</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-t border-border/40 align-top">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(r.at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest ${
                          r.kind === "policy_agreement"
                            ? "bg-primary/15 text-primary"
                            : "bg-emerald-500/15 text-emerald-400"
                        }`}
                      >
                        {r.kind === "policy_agreement" ? "agreement" : "waiver"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-foreground">{r.user_display_name ?? "—"}</div>
                      <div
                        className="text-[10px] text-muted-foreground truncate max-w-[16ch]"
                        title={r.user_id}
                      >
                        {r.user_id.slice(0, 8)}…
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.event_id ? (
                        <Link
                          to="/events/$id/edit"
                          params={{ id: r.event_id }}
                          className="text-primary hover:underline"
                        >
                          {r.event_title ?? r.event_id.slice(0, 8) + "…"}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">— (no event)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {r.policy_version_label ? (
                        <span className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase tracking-widest text-foreground/80">
                          v{r.policy_version_label}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      <div className="space-y-0.5">
                        {r.action && <div className="text-foreground/80">{r.action}</div>}
                        {r.ip_address && <div>IP: {r.ip_address}</div>}
                        {r.user_agent && (
                          <div className="truncate max-w-[36ch]" title={r.user_agent}>
                            UA: {r.user_agent}
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
