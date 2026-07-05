import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { getDoorSheet } from "@/lib/checkin.functions";
import type { VideoConsent } from "@/lib/verification.functions";

export const Route = createFileRoute("/_authenticated/events/$id/checkin/print")({
  head: () => ({ meta: [{ title: "Door sheet · AFTERDARK" }] }),
  component: PrintPage,
});

function consentSummary(c: VideoConsent | null): string {
  if (!c) return "—";
  const bits: string[] = [];
  if (c.no_filming) bits.push("NO FILM");
  if (c.face_blurred_only) bits.push("Blur only");
  if (c.private_archive) bits.push("Archive");
  if (c.public_promo) bits.push("Promo OK");
  return bits.length ? bits.join(", ") : "No preference";
}

function PrintPage() {
  const { id: eventId } = Route.useParams();
  const fn = useServerFn(getDoorSheet);
  const { data, isLoading, error } = useQuery({
    queryKey: ["door-sheet", eventId],
    queryFn: () => fn({ data: { event_id: eventId } }),
  });

  // Auto-open print dialog once loaded
  useEffect(() => {
    if (data) {
      const t = setTimeout(() => window.print(), 400);
      return () => clearTimeout(t);
    }
  }, [data]);

  if (isLoading) return <div className="p-10 text-sm">Loading door sheet…</div>;
  if (error) return <div className="p-10 text-sm text-destructive">{(error as Error).message}</div>;
  if (!data) return null;

  const ev = data.event;
  const d = new Date(ev.starts_at);

  return (
    <>
      <style>{`
        @media print {
          @page { size: A4; margin: 12mm; }
          .no-print { display: none !important; }
          body { background: white !important; }
        }
        .sheet { color: #000; background: #fff; }
        .sheet table { width: 100%; border-collapse: collapse; font-size: 11pt; }
        .sheet th, .sheet td { border: 1px solid #000; padding: 6px 8px; text-align: left; vertical-align: top; }
        .sheet th { background: #eee; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.1em; }
        .sheet .code { font-family: ui-monospace, Menlo, monospace; letter-spacing: 0.1em; font-weight: bold; }
        .sheet .box { display: inline-block; width: 14px; height: 14px; border: 1.5px solid #000; vertical-align: middle; }
        .sheet .warn { color: #b00020; font-weight: bold; }
      `}</style>

      <div className="no-print flex items-center justify-between gap-3 border-b border-border bg-card px-6 py-3">
        <Link
          to="/events/$id/checkin"
          params={{ id: eventId }}
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Back to check-in
        </Link>
        <div className="text-xs text-muted-foreground">
          {data.guests.length} guests · {data.total_heads} heads
        </div>
        <button
          onClick={() => window.print()}
          className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground"
        >
          Print
        </button>
      </div>

      <main className="sheet mx-auto max-w-[210mm] p-8">
        <header style={{ borderBottom: "2px solid #000", paddingBottom: 8, marginBottom: 16 }}>
          <div style={{ fontSize: "9pt", textTransform: "uppercase", letterSpacing: "0.2em" }}>
            Door admission sheet
          </div>
          <h1 style={{ margin: "4px 0 2px", fontSize: "22pt", fontWeight: 800 }}>{ev.title}</h1>
          <div style={{ fontSize: "10pt" }}>
            {d.toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
            {" · "}
            {d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {" · "}
            {ev.venue_name}
            {ev.city ? `, ${ev.city}` : ""}
          </div>
          {ev.address && <div style={{ fontSize: "10pt" }}>{ev.address}</div>}
          {ev.dress_code && (
            <div style={{ fontSize: "9pt", marginTop: 4 }}>
              <strong>Dress code:</strong> {ev.dress_code}
            </div>
          )}
          <div style={{ marginTop: 8, fontSize: "9pt" }}>
            <strong>{data.guests.length}</strong> confirmed RSVPs ·{" "}
            <strong>{data.total_heads}</strong> total heads expected
          </div>
        </header>

        <table>
          <thead>
            <tr>
              <th style={{ width: "24px" }}>✓</th>
              <th style={{ width: "110px" }}>Ticket</th>
              <th>Guest</th>
              <th style={{ width: "50px" }}>Party</th>
              <th style={{ width: "70px" }}>ID</th>
              <th>Video consent</th>
            </tr>
          </thead>
          <tbody>
            {data.guests.map((g) => (
              <tr key={g.id}>
                <td style={{ textAlign: "center" }}>
                  <span className="box" />
                </td>
                <td className="code">{g.ticket_code}</td>
                <td>{g.display_name ?? "—"}</td>
                <td style={{ textAlign: "center" }}>{g.guest_count}</td>
                <td className={g.age_status !== "approved" ? "warn" : ""}>
                  {g.age_status === "approved" ? "OK" : g.age_status.toUpperCase()}
                </td>
                <td>{consentSummary(g.consent)}</td>
              </tr>
            ))}
            {data.guests.length === 0 && (
              <tr>
                <td colSpan={6} style={{ textAlign: "center", padding: 20 }}>
                  No confirmed RSVPs yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <footer style={{ marginTop: 16, fontSize: "9pt", borderTop: "1px solid #000", paddingTop: 8 }}>
          Verify photo ID at the door. Any guest without <strong>ID: OK</strong> must not be
          admitted. Circle party-size changes and note walk-ins on the back. Printed{" "}
          {new Date().toLocaleString()}.
        </footer>
      </main>
    </>
  );
}
