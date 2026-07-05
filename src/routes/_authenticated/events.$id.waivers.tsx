import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { listEventWaivers, listWaiverAudit } from "@/lib/host.functions";
import { useWaiverPdfDownload } from "@/lib/useWaiverPdfDownload";


export const Route = createFileRoute("/_authenticated/events/$id/waivers")({
  head: () => ({
    meta: [
      { title: "RSVP waivers · AFTERDARK" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: WaiversPage,
});

function WaiversPage() {
  const { id: eventId } = Route.useParams();
  const fetchWaivers = useServerFn(listEventWaivers);
  const fetchAudit = useServerFn(listWaiverAudit);
  const q = useQuery({
    queryKey: ["event-waivers", eventId],
    queryFn: () => fetchWaivers({ data: { eventId } }),
  });
  const auditQ = useQuery({
    queryKey: ["event-waiver-audit", eventId],
    queryFn: () => fetchAudit({ data: { eventId } }),
  });

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-5 py-10">
      <div className="flex items-center justify-between gap-4">
        <div>
          <Link
            to="/events/$id/edit"
            params={{ id: eventId }}
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Back to event
          </Link>
          <h1 className="mt-3 font-display text-3xl font-semibold">RSVP waivers</h1>
          {q.data?.event.title && (
            <p className="text-sm text-muted-foreground">{q.data.event.title}</p>
          )}
        </div>
        <button
          onClick={() => {
            q.refetch();
            auditQ.refetch();
          }}
          className="rounded-md border border-border px-3 py-1.5 text-xs uppercase tracking-widest hover:bg-card"
        >
          {q.isFetching || auditQ.isFetching ? "…" : "Refresh"}
        </button>
      </div>

      {q.isLoading && <p className="mt-10 text-sm text-muted-foreground">Loading…</p>}
      {q.error && (
        <p className="mt-10 text-sm text-red-400">
          {(q.error as Error).message ?? "Failed to load."}
        </p>
      )}

      {q.data && (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="RSVPs" value={q.data.summary.total} />
            <Stat label="Accepted" value={q.data.summary.accepted} tone="ok" />
            <Stat label="Missing" value={q.data.summary.missing} tone={q.data.summary.missing ? "warn" : undefined} />
            <Stat label="Out-of-date" value={q.data.summary.stale} tone={q.data.summary.stale ? "warn" : undefined} />
          </div>

          <div className="mt-6 rounded-md border border-border/60 bg-card/40 p-3 text-[11px] text-muted-foreground">
            <span className="uppercase tracking-widest text-foreground/70">Current waiver hash:</span>{" "}
            <code className="break-all font-mono">{q.data.currentHash}</code>
          </div>

          <div className="mt-6 overflow-x-auto rounded-lg border border-border/60">
            <table className="w-full text-sm">
              <thead className="bg-card/60 text-[10px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Guest</th>
                  <th className="px-3 py-2 text-left">Ticket</th>
                  <th className="px-3 py-2 text-left">Accepted</th>
                  <th className="px-3 py-2 text-left">Signature</th>
                  <th className="px-3 py-2 text-left">Waiver hash</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rsvps.length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">
                      No RSVPs yet.
                    </td>
                  </tr>
                )}
                {q.data.rsvps.map((r) => (
                  <Row key={r.id} r={r} currentHash={q.data.currentHash} />
                ))}
              </tbody>
            </table>
          </div>
          <AuditSection
            entries={auditQ.data ?? []}
            currentHash={q.data.currentHash}
            loading={auditQ.isLoading}
            error={auditQ.error ? (auditQ.error as Error).message : null}
          />
        </>
      )}
    </main>
  );
}

type AuditRow = Awaited<ReturnType<typeof listWaiverAudit>>[number];

function AuditSection({
  entries,
  currentHash,
  loading,
  error,
}: {
  entries: AuditRow[];
  currentHash: string;
  loading: boolean;
  error: string | null;
}) {
  return (
    <section className="mt-10">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-primary">Audit trail</div>
          <h2 className="mt-1 font-display text-xl font-semibold">Waiver acceptance events</h2>
        </div>
        <span className="text-[11px] text-muted-foreground">{entries.length} entries</span>
      </div>
      {loading && <p className="text-sm text-muted-foreground">Loading audit trail…</p>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {!loading && !error && entries.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No waiver events recorded yet. Entries appear here when guests accept, re-sign, or
          cancel a waiver.
        </p>
      )}
      {entries.length > 0 && (
        <ul className="divide-y divide-border/50 rounded-lg border border-border/60">
          {entries.map((e) => {
            const stale =
              e.action !== "rescinded" &&
              e.waiver_text_hash != null &&
              e.waiver_text_hash !== currentHash;
            const badge =
              e.action === "accepted"
                ? { text: "Accepted", cls: "bg-emerald-500/15 text-emerald-300" }
                : e.action === "re_accepted"
                ? { text: "Re-signed", cls: "bg-sky-500/15 text-sky-300" }
                : { text: "Rescinded", cls: "bg-red-500/15 text-red-300" };
            const shortHash = e.waiver_text_hash
              ? `${e.waiver_text_hash.slice(0, 10)}…${e.waiver_text_hash.slice(-6)}`
              : "—";
            return (
              <li key={e.id} className="p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${badge.cls}`}>
                    {badge.text}
                  </span>
                  <span className="text-foreground">{e.display_name ?? "Guest"}</span>
                  {stale && (
                    <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] uppercase tracking-widest text-amber-300">
                      Old waiver
                    </span>
                  )}
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1.5 grid gap-x-4 gap-y-1 text-[11px] text-muted-foreground sm:grid-cols-2">
                  <div>
                    <span className="uppercase tracking-widest text-foreground/60">Signature:</span>{" "}
                    {e.waiver_signature ? (
                      <span className="font-serif italic text-foreground">
                        {e.waiver_signature}
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div className="break-all">
                    <span className="uppercase tracking-widest text-foreground/60">Hash:</span>{" "}
                    <code className="font-mono" title={e.waiver_text_hash ?? undefined}>
                      {shortHash}
                    </code>
                  </div>
                  {e.ip_address && (
                    <div>
                      <span className="uppercase tracking-widest text-foreground/60">IP:</span>{" "}
                      <code className="font-mono">{e.ip_address}</code>
                    </div>
                  )}
                  {e.user_agent && (
                    <div className="truncate" title={e.user_agent}>
                      <span className="uppercase tracking-widest text-foreground/60">UA:</span>{" "}
                      {e.user_agent}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" }) {
  const cls =
    tone === "ok"
      ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
      : tone === "warn"
      ? "border-amber-500/40 bg-amber-500/10 text-amber-200"
      : "border-border/60 bg-card/40 text-foreground";
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <div className="text-[10px] uppercase tracking-widest opacity-80">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold">{value}</div>
    </div>
  );
}

type RsvpRow = Awaited<ReturnType<typeof listEventWaivers>>["rsvps"][number];

function Row({ r, currentHash }: { r: RsvpRow; currentHash: string }) {
  const [open, setOpen] = useState(false);
  const badge = r.waiver_accepted
    ? r.waiver_hash_current
      ? { text: "Accepted", cls: "bg-emerald-500/15 text-emerald-300" }
      : { text: "Out-of-date", cls: "bg-amber-500/15 text-amber-300" }
    : { text: "Missing", cls: "bg-red-500/15 text-red-300" };

  const shortHash = r.waiver_text_hash
    ? `${r.waiver_text_hash.slice(0, 10)}…${r.waiver_text_hash.slice(-6)}`
    : "—";

  return (
    <>
      <tr className="border-t border-border/50 align-top">
        <td className="px-3 py-3">
          <div className="text-foreground">{r.display_name ?? "Guest"}</div>
          <div className="text-[11px] text-muted-foreground">
            {r.status} · {new Date(r.created_at).toLocaleString()}
          </div>
        </td>
        <td className="px-3 py-3 font-mono text-xs">{r.ticket_code}</td>
        <td className="px-3 py-3">
          <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-widest ${badge.cls}`}>
            {badge.text}
          </span>
          {r.waiver_accepted_at && (
            <div className="mt-1 text-[11px] text-muted-foreground">
              {new Date(r.waiver_accepted_at).toLocaleString()}
            </div>
          )}
        </td>
        <td className="px-3 py-3">
          {r.waiver_signature ? (
            <span className="font-serif italic text-foreground">{r.waiver_signature}</span>
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </td>
        <td className="px-3 py-3">
          <button
            onClick={() => setOpen((v) => !v)}
            className="font-mono text-xs text-primary hover:underline"
            title={r.waiver_text_hash ?? undefined}
          >
            {shortHash}
          </button>
        </td>
      </tr>
      {open && r.waiver_text_hash && (
        <tr className="bg-background/60">
          <td colSpan={5} className="px-3 py-3 text-[11px] text-muted-foreground">
            <div className="break-all font-mono">
              <span className="uppercase tracking-widest text-foreground/70">Signed hash:</span>{" "}
              {r.waiver_text_hash}
            </div>
            <div className="mt-1 break-all font-mono">
              <span className="uppercase tracking-widest text-foreground/70">Current:</span>{" "}
              {currentHash}
            </div>
            {!r.waiver_hash_current && (
              <div className="mt-2 text-amber-300">
                Signed against a previous version of the waiver — ask guest to re-sign if
                material terms changed.
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
