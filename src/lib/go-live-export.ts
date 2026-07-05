import type { GoLiveStatus } from "@/lib/go-live-status.functions";

/**
 * Pure builders for the /admin/go-live report export.
 *
 * Two output formats:
 *  - CSV: machine-friendly; sectioned so a human can also read it.
 *  - Printable HTML: opened in a new tab; the browser's print dialog lets
 *    the admin save it as a PDF without any extra runtime dependency.
 *
 * Kept as pure functions so both can be unit-tested without touching the
 * DOM.
 */

export function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  // RFC 4180: wrap in quotes and double any embedded quotes when the value
  // contains a comma, quote, CR, or LF.
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmtTs(v: string | null | undefined): string {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function buildGoLiveCsv(
  data: GoLiveStatus,
  expectedJobs: readonly string[],
  now: Date = new Date(),
): string {
  const lines: string[] = [];
  const push = (row: unknown[]) => lines.push(row.map(csvEscape).join(","));

  push(["Go-Live status report"]);
  push(["Generated at (UTC)", now.toISOString()]);
  push([]);

  // Scheduled jobs — one row per expected job, then any unexpected extras.
  push(["Scheduled jobs"]);
  push(["jobname", "schedule", "status", "expected"]);
  const byName = new Map(data.cron_jobs.map((j) => [j.jobname, j] as const));
  for (const name of expectedJobs) {
    const job = byName.get(name);
    const status = !job ? "missing" : job.active ? "active" : "inactive";
    push([name, job?.schedule ?? "", status, "yes"]);
  }
  for (const job of data.cron_jobs) {
    if (expectedJobs.includes(job.jobname)) continue;
    push([job.jobname, job.schedule, job.active ? "active" : "inactive", "no"]);
  }
  push([]);

  // Last successful email.
  push(["Last successful email"]);
  push(["field", "value"]);
  push(["sent_at_utc", fmtTs(data.last_email_sent_at)]);
  push(["template", data.last_email_template ?? ""]);
  push(["recipient", data.last_email_recipient ?? ""]);
  push([]);

  // RSVP entry-phrase assignment counts.
  push(["RSVP entry phrase assignment"]);
  push(["field", "value"]);
  push(["rsvp_total", data.rsvp_total]);
  push(["rsvp_with_entry_phrase", data.rsvp_with_entry_phrase]);
  push([
    "rsvp_missing_entry_phrase",
    Math.max(0, data.rsvp_total - data.rsvp_with_entry_phrase),
  ]);
  push(["last_entry_phrase_at_utc", fmtTs(data.last_entry_phrase_at)]);

  return lines.join("\r\n") + "\r\n";
}

export function goLiveExportFilename(
  ext: "csv" | "pdf",
  now: Date = new Date(),
): string {
  // e.g. go-live-status-2026-06-01T12-34-56Z.csv
  const stamp = now.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
  return `go-live-status-${stamp}.${ext}`;
}

function htmlEscape(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildGoLiveHtml(
  data: GoLiveStatus,
  expectedJobs: readonly string[],
  now: Date = new Date(),
): string {
  const byName = new Map(data.cron_jobs.map((j) => [j.jobname, j] as const));
  const jobRows = [
    ...expectedJobs.map((name) => {
      const job = byName.get(name);
      const status = !job ? "missing" : job.active ? "active" : "inactive";
      return {
        name,
        schedule: job?.schedule ?? "—",
        status,
        expected: true,
      };
    }),
    ...data.cron_jobs
      .filter((j) => !expectedJobs.includes(j.jobname))
      .map((j) => ({
        name: j.jobname,
        schedule: j.schedule,
        status: j.active ? "active" : "inactive",
        expected: false,
      })),
  ];

  const jobsTable = jobRows
    .map(
      (r) =>
        `<tr><td>${htmlEscape(r.name)}</td><td>${htmlEscape(
          r.schedule,
        )}</td><td class="s-${r.status}">${r.status}</td><td>${
          r.expected ? "yes" : "no"
        }</td></tr>`,
    )
    .join("");

  const missing = Math.max(0, data.rsvp_total - data.rsvp_with_entry_phrase);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Go-Live status — ${htmlEscape(now.toISOString())}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #111; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #555; font-size: 12px; margin-bottom: 24px; }
  h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.15em; color: #555; margin: 24px 0 8px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #ddd; }
  th { background: #f4f4f5; font-weight: 600; }
  td.s-active { color: #047857; }
  td.s-inactive { color: #b91c1c; }
  td.s-missing { color: #b45309; }
  dl { display: grid; grid-template-columns: 200px 1fr; gap: 4px 12px; font-size: 12px; margin: 0; }
  dt { color: #555; }
  dd { margin: 0; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .actions { margin-top: 24px; }
  @media print { .actions { display: none; } body { margin: 16mm; } }
</style>
</head>
<body>
  <h1>Go-Live status report</h1>
  <div class="sub">Generated at ${htmlEscape(now.toISOString())} (UTC)</div>

  <h2>Scheduled jobs</h2>
  <table>
    <thead><tr><th>Job</th><th>Schedule</th><th>Status</th><th>Expected</th></tr></thead>
    <tbody>${jobsTable}</tbody>
  </table>

  <h2>Last successful email</h2>
  <dl>
    <dt>Sent at (UTC)</dt><dd>${htmlEscape(fmtTs(data.last_email_sent_at) || "—")}</dd>
    <dt>Template</dt><dd>${htmlEscape(data.last_email_template ?? "—")}</dd>
    <dt>Recipient</dt><dd>${htmlEscape(data.last_email_recipient ?? "—")}</dd>
  </dl>

  <h2>RSVP entry phrase assignment</h2>
  <dl>
    <dt>Total RSVPs</dt><dd>${htmlEscape(data.rsvp_total)}</dd>
    <dt>With entry phrase</dt><dd>${htmlEscape(data.rsvp_with_entry_phrase)}</dd>
    <dt>Missing entry phrase</dt><dd>${htmlEscape(missing)}</dd>
    <dt>Most recent assignment (UTC)</dt><dd>${htmlEscape(fmtTs(data.last_entry_phrase_at) || "—")}</dd>
  </dl>

  <div class="actions">
    <button type="button" onclick="window.print()">Print / Save as PDF</button>
  </div>
</body>
</html>`;
}
