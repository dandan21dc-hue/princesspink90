import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { listComplianceAuditLog } from "@/lib/compliance-policy.functions";
import { listPolicyVersions } from "@/lib/host.functions";

export const Route = createFileRoute("/_authenticated/admin/compliance-audit")({
  head: () => ({
    meta: [
      { title: "Compliance audit log — Admin" },
      { name: "description", content: "Audit trail of policy agreements and document uploads keyed by policy version." },
    ],
  }),
  component: AdminComplianceAuditPage,
});

function AdminComplianceAuditPage() {
  const [versionFilter, setVersionFilter] = useState<string>("");
  const [kindFilter, setKindFilter] = useState<"all" | "agreement" | "document">("all");

  const versionsFn = useServerFn(listPolicyVersions);
  const auditFn = useServerFn(listComplianceAuditLog);

  const versions = useQuery({
    queryKey: ["compliance-policy-list"],
    queryFn: () => versionsFn(),
  });

  const audit = useQuery({
    queryKey: ["compliance-audit", versionFilter],
    queryFn: () =>
      auditFn({ data: { policy_version_id: versionFilter || null, limit: 300 } }),
  });

  const rows = (audit.data ?? []).filter((r) =>
    kindFilter === "all" ? true : r.kind === kindFilter,
  );

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
        <h1 className="mt-2 font-display text-3xl font-semibold">Compliance audit log</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
          Every policy agreement and compliance document upload, tagged with the
          policy version that was in force at the time. Filter by version to see
          exactly who agreed and what evidence was submitted.
        </p>
      </header>

      <section className="mx-auto max-w-5xl px-5 pb-6">
        <div className="flex flex-wrap items-end gap-4 rounded-2xl border border-border/60 bg-card/60 p-4">
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">Policy version</div>
            <select
              value={versionFilter}
              onChange={(e) => setVersionFilter(e.target.value)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="">All versions</option>
              {(versions.data ?? []).map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version}
                  {v.is_current ? " (current)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-xs">
            <div className="mb-1.5 uppercase tracking-widest text-muted-foreground">Kind</div>
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as any)}
              className="rounded-md border border-input bg-background px-3 py-2 text-sm"
            >
              <option value="all">All entries</option>
              <option value="agreement">Agreements only</option>
              <option value="document">Uploads only</option>
            </select>
          </label>
          <div className="ml-auto text-xs text-muted-foreground">
            {audit.isLoading ? "Loading…" : `${rows.length} entries`}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-5 pb-16">
        {audit.error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
            {audit.error instanceof Error ? audit.error.message : "Failed to load audit log"}
          </div>
        )}
        {!audit.isLoading && rows.length === 0 && (
          <div className="rounded-lg border border-border/60 bg-card/60 p-6 text-sm text-muted-foreground">
            No audit entries match the current filter.
          </div>
        )}
        {rows.length > 0 && (
          <div className="overflow-x-auto rounded-2xl border border-border/60 bg-card/60">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Kind</th>
                  <th className="px-4 py-3">Host</th>
                  <th className="px-4 py-3">Event</th>
                  <th className="px-4 py-3">Policy</th>
                  <th className="px-4 py-3">Details</th>
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
                          r.kind === "agreement"
                            ? "bg-primary/15 text-primary"
                            : "bg-emerald-500/15 text-emerald-400"
                        }`}
                      >
                        {r.kind}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-foreground">{r.user_display_name ?? "—"}</div>
                      <div className="text-[10px] text-muted-foreground truncate max-w-[16ch]" title={r.user_id}>
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
                        <span className="text-muted-foreground">unversioned</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {r.kind === "agreement" ? (
                        <div className="space-y-0.5">
                          <div>Agreement recorded</div>
                          {r.ip_address && <div>IP: {r.ip_address}</div>}
                          {r.user_agent && (
                            <div className="truncate max-w-[36ch]" title={r.user_agent}>
                              UA: {r.user_agent}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <div>
                            <span className="text-foreground/80">{r.doc_type}</span> ·{" "}
                            <span className="truncate">{r.file_name}</span>
                          </div>
                        </div>
                      )}
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
