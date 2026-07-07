/**
 * Shared, timezone-aware formatters for private-room booking emails.
 * `timeZone` is an IANA name (e.g. "Australia/Sydney", "America/Los_Angeles").
 * Invalid or missing values fall back to the venue timezone.
 */
const FALLBACK_TZ = "Australia/Sydney";

function safeTimeZone(tz?: string | null): string {
  if (!tz) return FALLBACK_TZ;
  try {
    // Throws RangeError on invalid IANA name.
    new Intl.DateTimeFormat("en-AU", { timeZone: tz });
    return tz;
  } catch {
    return FALLBACK_TZ;
  }
}

export interface FormattedBookingTime {
  dateLabel: string;
  timeLabel: string;
  timeZone: string;
}

export function formatBookingDateTime(
  startsAt: Date | string,
  durationMinutes: number,
  timeZone?: string | null,
): FormattedBookingTime {
  const starts = startsAt instanceof Date ? startsAt : new Date(startsAt);
  const ends = new Date(starts.getTime() + durationMinutes * 60_000);
  const tz = safeTimeZone(timeZone);

  const dateLabel = new Intl.DateTimeFormat("en-AU", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: tz,
  }).format(starts);

  const timeFmt = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  });
  const tzNameFmt = new Intl.DateTimeFormat("en-AU", {
    hour: "numeric",
    timeZone: tz,
    timeZoneName: "short",
  });
  // Extract just the "AEST"/"PDT"/etc. portion from the formatted parts.
  const zoneName =
    tzNameFmt.formatToParts(starts).find((p) => p.type === "timeZoneName")?.value ?? tz;

  const timeLabel = `${timeFmt.format(starts)} – ${timeFmt.format(ends)} ${zoneName}`;

  return { dateLabel, timeLabel, timeZone: tz };
}
