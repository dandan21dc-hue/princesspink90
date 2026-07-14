import { formatBookingDateTime } from "@/lib/booking-format";

interface EnqueueBookingRescheduledEmailArgs {
  bookingId: string;
  recipient: string;
  oldStartsAt: string;
  newStartsAt: string;
  durationMinutes: number;
  partySize: number;
  amountCents: number | null;
  currency: string | null;
  timeZone?: string;
  reason?: string;
  rescheduledByStaff: boolean;
}

/**
 * Enqueue the "booking rescheduled" email. Called from both the self-serve
 * and admin reschedule server functions after the booking's starts_at has
 * moved. Idempotent per (booking, new start time) so retries dedupe but a
 * subsequent second reschedule still sends.
 */
export async function enqueueBookingRescheduledEmail(
  args: EnqueueBookingRescheduledEmailArgs,
): Promise<void> {
  const {
    bookingId,
    recipient,
    oldStartsAt,
    newStartsAt,
    durationMinutes,
    partySize,
    amountCents,
    currency,
    timeZone,
    reason,
    rescheduledByStaff,
  } = args;

  const { dateLabel: oldDateLabel, timeLabel: oldTimeLabel } = formatBookingDateTime(
    oldStartsAt,
    durationMinutes,
    timeZone,
  );
  const { dateLabel, timeLabel } = formatBookingDateTime(
    newStartsAt,
    durationMinutes,
    timeZone,
  );
  const durationLabel = durationMinutes === 30 ? "30-minute session" : "1-hour session";

  const amount =
    amountCents != null
      ? new Intl.NumberFormat("en-AU", {
          style: "currency",
          currency: (currency ?? "aud").toUpperCase(),
        }).format(amountCents / 100)
      : undefined;

  const origin =
    process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ??
    process.env.SITE_URL?.replace(/\/$/, "") ??
    "https://princesspink90.com";
  const icsUrl = `${origin}/api/public/bookings/${bookingId}/ics`;
  const dashboardUrl = `${origin}/bookings`;
  const bookingUrl = `${origin}/bookings?booking=${bookingId}&action=view`;
  const rescheduleUrl = `${origin}/bookings?booking=${bookingId}&action=reschedule`;
  const cancelUrl = `${origin}/bookings?booking=${bookingId}&action=cancel`;

  // Include the new start time in the idempotency key so a first reschedule
  // and a later second reschedule each send their own notification, while
  // duplicate calls for the same move dedupe.
  const idempotencySuffix = new Date(newStartsAt).getTime();
  const { enqueueTemplateEmail } = await import("@/lib/email/enqueue.server");
  await enqueueTemplateEmail({
    templateName: "booking-rescheduled",
    recipientEmail: recipient,
    idempotencyKey: `booking-rescheduled-${bookingId}-${idempotencySuffix}`,
    templateData: {
      oldDateLabel,
      oldTimeLabel,
      dateLabel,
      timeLabel,
      durationLabel,
      partySize,
      amount,
      bookingId,
      icsUrl,
      dashboardUrl,
      bookingUrl,
      rescheduleUrl,
      cancelUrl,
      reason,
      rescheduledByStaff,
    },
  });
}
