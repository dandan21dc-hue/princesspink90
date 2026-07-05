import { describe, expect, it } from "vitest";
import {
  buildGoLiveCsv,
  buildGoLiveHtml,
  csvEscape,
  goLiveExportFilename,
} from "./go-live-export";
import type { GoLiveStatus } from "./go-live-status.functions";

const EXPECTED = [
  "health-screening-expiry-reminders",
  "venue-compliance-expiry-reminders",
] as const;

const NOW = new Date("2026-06-01T12:34:56.000Z");

function makeStatus(overrides: Partial<GoLiveStatus> = {}): GoLiveStatus {
  return {
    cron_jobs: [
      {
        jobname: "health-screening-expiry-reminders",
        schedule: "0 9 * * *",
        active: true,
      },
      // second expected job missing on purpose
      {
        jobname: "some-other-job",
        schedule: "*/15 * * * *",
        active: false,
      },
    ],
    last_email_sent_at: "2026-05-31T10:00:00.000Z",
    last_email_template: "health-screening-reminder",
    last_email_recipient: "ops@example.com",
    rsvp_total: 12,
    rsvp_with_entry_phrase: 9,
    last_entry_phrase_at: "2026-05-30T08:00:00.000Z",
    ...overrides,
  };
}

describe("csvEscape", () => {
  it("returns empty string for null/undefined", () => {
    expect(csvEscape(null)).toBe("");
    expect(csvEscape(undefined)).toBe("");
  });
  it("passes plain strings through unquoted", () => {
    expect(csvEscape("hello")).toBe("hello");
    expect(csvEscape(42)).toBe("42");
  });
  it("quotes and doubles inner quotes for values with special chars", () => {
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvEscape("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("buildGoLiveCsv", () => {
  it("emits a sectioned CSV with expected jobs, extras, email, and counts", () => {
    const csv = buildGoLiveCsv(makeStatus(), EXPECTED, NOW);
    // Sections present, in order.
    const idx = (s: string) => csv.indexOf(s);
    expect(idx("Go-Live status report")).toBe(0);
    expect(idx("Scheduled jobs")).toBeGreaterThan(0);
    expect(idx("Last successful email")).toBeGreaterThan(idx("Scheduled jobs"));
    expect(idx("RSVP entry phrase assignment")).toBeGreaterThan(
      idx("Last successful email"),
    );

    // Expected job present → "active,yes"; expected job missing → "missing,yes";
    // unexpected extra job present → "inactive,no".
    expect(csv).toContain(
      "health-screening-expiry-reminders,0 9 * * *,active,yes",
    );
    expect(csv).toContain(
      "venue-compliance-expiry-reminders,,missing,yes",
    );
    expect(csv).toContain("some-other-job,*/15 * * * *,inactive,no");

    // Email + count rows.
    expect(csv).toContain("sent_at_utc,2026-05-31T10:00:00.000Z");
    expect(csv).toContain("template,health-screening-reminder");
    expect(csv).toContain("recipient,ops@example.com");
    expect(csv).toContain("rsvp_total,12");
    expect(csv).toContain("rsvp_with_entry_phrase,9");
    expect(csv).toContain("rsvp_missing_entry_phrase,3");
    expect(csv).toContain("last_entry_phrase_at_utc,2026-05-30T08:00:00.000Z");

    // Generated-at timestamp is in the header block.
    expect(csv).toContain(`Generated at (UTC),${NOW.toISOString()}`);
    // CRLF line endings per RFC 4180.
    expect(csv).toContain("\r\n");
  });

  it("handles null email/phrase fields without crashing", () => {
    const csv = buildGoLiveCsv(
      makeStatus({
        last_email_sent_at: null,
        last_email_template: null,
        last_email_recipient: null,
        last_entry_phrase_at: null,
        rsvp_total: 0,
        rsvp_with_entry_phrase: 0,
      }),
      EXPECTED,
      NOW,
    );
    expect(csv).toContain("sent_at_utc,");
    expect(csv).toContain("template,");
    expect(csv).toContain("recipient,");
    expect(csv).toContain("rsvp_total,0");
    expect(csv).toContain("rsvp_with_entry_phrase,0");
    expect(csv).toContain("rsvp_missing_entry_phrase,0");
  });

  it("quotes values that contain commas", () => {
    const csv = buildGoLiveCsv(
      makeStatus({
        last_email_template: "reminder,v2",
      }),
      EXPECTED,
      NOW,
    );
    expect(csv).toContain('template,"reminder,v2"');
  });
});

describe("buildGoLiveHtml", () => {
  it("renders every RPC field and marks missing/expected jobs", () => {
    const html = buildGoLiveHtml(makeStatus(), EXPECTED, NOW);
    expect(html).toContain("<title>Go-Live status");
    expect(html).toContain("health-screening-expiry-reminders");
    // Missing expected job renders with class s-missing.
    expect(html).toContain('class="s-missing">missing');
    // Extra job renders as inactive with expected=no.
    expect(html).toContain("some-other-job");
    // Email + RSVP fields present.
    expect(html).toContain("health-screening-reminder");
    expect(html).toContain("ops@example.com");
    expect(html).toContain(">12</dd>"); // total
    expect(html).toContain(">9</dd>"); // with phrase
    expect(html).toContain(">3</dd>"); // missing = 12 - 9
  });

  it("escapes HTML in template/recipient values", () => {
    const html = buildGoLiveHtml(
      makeStatus({
        last_email_template: "<script>alert(1)</script>",
        last_email_recipient: "a&b@example.com",
      }),
      EXPECTED,
      NOW,
    );
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("a&amp;b@example.com");
  });
});

describe("goLiveExportFilename", () => {
  it("builds a colon-free filename with the requested extension", () => {
    const csv = goLiveExportFilename("csv", NOW);
    const pdf = goLiveExportFilename("pdf", NOW);
    expect(csv).toBe("go-live-status-2026-06-01T12-34-56Z.csv");
    expect(pdf).toBe("go-live-status-2026-06-01T12-34-56Z.pdf");
    expect(csv).not.toContain(":");
  });
});
