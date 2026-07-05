// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { GoLiveStatusView } from "./GoLiveStatusView";
import type { GoLiveStatus } from "@/lib/go-live-status.functions";

const EXPECTED_JOBS = [
  "health-screening-expiry-reminders",
  "venue-compliance-expiry-reminders",
  "reminder-retries-every-5-min",
  "purge-expired-health-screenings",
] as const;

function makeStatus(overrides: Partial<GoLiveStatus> = {}): GoLiveStatus {
  return {
    cron_jobs: EXPECTED_JOBS.map((jobname) => ({
      jobname,
      schedule: "0 9 * * *",
      active: true,
    })),
    last_email_sent_at: "2026-06-01T12:34:56.000Z",
    last_email_template: "health-screening-reminder",
    last_email_recipient: "ops@example.com",
    rsvp_total: 12,
    rsvp_with_entry_phrase: 9,
    last_entry_phrase_at: "2026-06-02T10:00:00.000Z",
    ...overrides,
  };
}

describe("<GoLiveStatusView />", () => {
  it("renders loading placeholders when data is undefined", () => {
    render(<GoLiveStatusView data={undefined} expectedJobs={EXPECTED_JOBS} />);
    // Both cards that depend on `data` show Loading…; the email card shows
    // its own "no sends" copy.
    expect(screen.getAllByText("Loading…").length).toBeGreaterThanOrEqual(2);
    // Every expected job row renders with an em-dash schedule and "missing"
    // status when the RPC has not returned yet.
    for (const name of EXPECTED_JOBS) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getAllByText("missing")).toHaveLength(EXPECTED_JOBS.length);
  });

  it("renders all RPC fields and counts when all expected jobs are active", () => {
    const data = makeStatus();
    render(<GoLiveStatusView data={data} expectedJobs={EXPECTED_JOBS} />);

    // Cron summary card: active/total.
    expect(
      screen.getByText(`${EXPECTED_JOBS.length}/${EXPECTED_JOBS.length} expected active`),
    ).toBeTruthy();
    // Every expected job row renders with an "active" badge.
    expect(screen.getAllByText("active")).toHaveLength(EXPECTED_JOBS.length);

    // Last email section shows every field from the RPC.
    const emailSection = screen.getByRole("region", {
      name: /last successful email/i,
    });
    expect(within(emailSection).getByText(data.last_email_template!)).toBeTruthy();
    expect(within(emailSection).getByText(data.last_email_recipient!)).toBeTruthy();
    expect(
      within(emailSection).getByText(
        new Date(data.last_email_sent_at!).toLocaleString(),
      ),
    ).toBeTruthy();

    // RSVP section shows the counts from the RPC.
    const rsvpSection = screen.getByRole("region", {
      name: /rsvp entry phrase assignment/i,
    });
    expect(within(rsvpSection).getByText(String(data.rsvp_total))).toBeTruthy();
    expect(
      within(rsvpSection).getByText(String(data.rsvp_with_entry_phrase)),
    ).toBeTruthy();
    // Summary card shows the "with/total RSVPs" phrasing.
    expect(
      screen.getByText(
        `${data.rsvp_with_entry_phrase}/${data.rsvp_total} RSVPs`,
      ),
    ).toBeTruthy();

    // With phrases assigned, the "trigger may not be firing" warning is absent.
    expect(
      screen.queryByText(/trigger may not be firing/i),
    ).toBeNull();
  });

  it("counts only active expected jobs and marks missing/inactive rows", () => {
    const data = makeStatus({
      cron_jobs: [
        // one expected job present but inactive
        {
          jobname: "health-screening-expiry-reminders",
          schedule: "0 9 * * *",
          active: false,
        },
        // one expected job active
        {
          jobname: "venue-compliance-expiry-reminders",
          schedule: "0 10 * * *",
          active: true,
        },
        // two expected jobs entirely missing from cron.job
        // plus one unexpected extra job that should still render
        {
          jobname: "some-other-job",
          schedule: "*/15 * * * *",
          active: true,
        },
      ],
    });
    render(<GoLiveStatusView data={data} expectedJobs={EXPECTED_JOBS} />);

    // Summary: 1 of 4 expected active.
    expect(screen.getByText("1/4 expected active")).toBeTruthy();
    // Two expected jobs are missing.
    expect(screen.getAllByText("missing")).toHaveLength(2);
    // One expected job is inactive; the "extra" job is active.
    expect(screen.getAllByText("inactive")).toHaveLength(1);
    // Extra job still renders in the table.
    expect(screen.getByText("some-other-job")).toBeTruthy();
  });

  it("warns when RSVPs exist but none have an entry phrase", () => {
    const data = makeStatus({
      rsvp_total: 5,
      rsvp_with_entry_phrase: 0,
      last_entry_phrase_at: null,
    });
    render(<GoLiveStatusView data={data} expectedJobs={EXPECTED_JOBS} />);
    expect(
      screen.getByText(/trigger may not be firing/i),
    ).toBeTruthy();
    expect(screen.getByText("0/5 RSVPs")).toBeTruthy();
  });

  it("shows the 'no sends yet' copy when last_email_sent_at is null", () => {
    const data = makeStatus({
      last_email_sent_at: null,
      last_email_template: null,
      last_email_recipient: null,
    });
    render(<GoLiveStatusView data={data} expectedJobs={EXPECTED_JOBS} />);
    // Summary card detail text.
    expect(screen.getByText("No successful sends yet")).toBeTruthy();
    // Email section fallback copy.
    expect(
      screen.getByText(/no emails have been successfully sent yet/i),
    ).toBeTruthy();
  });
});
