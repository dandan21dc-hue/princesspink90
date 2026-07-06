import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { getTierAnalytics } from "@/lib/analytics.functions";

export const Route = createFileRoute("/_authenticated/admin/analytics")({
  head: () => ({
    meta: [
      { title: "Tier analytics — Admin" },
      {
        name: "description",
        content:
          "Boutique tier click counts and checkout conversion rates per plan.",
      },
    ],
  }),
  component: AdminAnalyticsPage,
});

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function AdminAnalyticsPage() {
  const [sinceDays, setSinceDays] = useState<number>(30);
  const fn = useServerFn(getTierAnalytics);
  const q = useQuery({
    queryKey: ["admin-tier-analytics", sinceDays],
    queryFn: () => fn({ data: { sinceDays } }),
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Tier analytics</h1>
          <p className="text-sm text-muted-foreground">
            Boutique tier clicks and checkout conversion, from persisted
            <code className="mx-1">analytics_events</code>.
          </p>
        </div>
        <label className="text-xs uppercase tracking-widest text-muted-foreground">
          Window
          <select
            className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            value={sinceDays}
            onChange={(e) => setSinceDays(Number(e.target.value))}
          >
            <option value={1}>Last 24h</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </label>
      </div>

      {q.isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {q.error && (
        <p className="text-sm text-destructive">
          {(q.error as Error).message}
        </p>
      )}

      {q.data && (
        <>
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Stat label="Total tier clicks" value={q.data.total_clicks.toLocaleString()} />
            <Stat label="Checkout completions" value={q.data.total_completions.toLocaleString()} />
            <Stat label="Overall conversion" value={pct(q.data.overall_conversion)} />
          </div>

          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2 text-right">Navigate clicks</th>
                  <th className="px-3 py-2 text-right">Blocked clicks</th>
                  <th className="px-3 py-2 text-right">Completions</th>
                  <th className="px-3 py-2 text-right">Conversion</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No events in this window.
                    </td>
                  </tr>
                )}
                {q.data.rows.map((r) => (
                  <tr key={r.plan} className="border-t border-border">
                    <td className="px-3 py-2 font-mono text-xs">{r.plan}</td>
                    <td className="px-3 py-2 text-right">{r.navigate_clicks}</td>
                    <td className="px-3 py-2 text-right">{r.blocked_clicks}</td>
                    <td className="px-3 py-2 text-right">{r.completions}</td>
                    <td className="px-3 py-2 text-right">
                      {r.navigate_clicks > 0 ? pct(r.conversion_rate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Recent events
          </h2>
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-muted/40 text-left uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Event</th>
                  <th className="px-3 py-2">Plan</th>
                  <th className="px-3 py-2">Action</th>
                  <th className="px-3 py-2">Tier kind</th>
                </tr>
              </thead>
              <tbody>
                {q.data.recent.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-2 font-mono">
                      {new Date(r.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">{r.event}</td>
                    <td className="px-3 py-2 font-mono">{r.plan ?? "—"}</td>
                    <td className="px-3 py-2">{r.action ?? "—"}</td>
                    <td className="px-3 py-2">{r.tier_kind ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold">{value}</div>
    </div>
  );
}
