import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { formatBookingDateTime } from "@/lib/booking-format";

/**
 * Send the private-room booking confirmation email to the signed-in user.
 * Idempotency key is derived from the booking id + template, so calling
 * this multiple times (page refresh, retry after transient error) produces
 * at most one delivered email per booking.
 */
export const sendBookingConfirmationEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bookingId: string; resend?: boolean; timeZone?: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.bookingId)) throw new Error("Invalid bookingId");
    return data;
  })
  .handler(async ({ data, context }) => {
    // RLS-scoped read as the signed-in user — a caller can only trigger the
    // email for their own booking.
    const { data: booking, error } = await context.supabase
      .from("private_room_bookings")
      .select(
        "id,starts_at,duration_minutes,status,amount_cents,currency,party_size,notes,customer_email",
      )
      .eq("id", data.bookingId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!booking) return { success: false, reason: "not_found" as const };
    if (booking.status !== "confirmed") {
      return { success: false, reason: "not_confirmed" as const };
    }

    // Prefer the checkout-collected email; fall back to the auth email if
    // Stripe didn't return one.
    const claimEmail =
      (context.claims as { email?: string } | null | undefined)?.email ?? null;
    const recipient = (booking.customer_email as string | null) ?? claimEmail;
    if (!recipient) return { success: false, reason: "no_recipient" as const };

    const starts = new Date(booking.starts_at as string);
    const durationMinutes = booking.duration_minutes as number;
    const ends = new Date(starts.getTime() + durationMinutes * 60_000);

    const dateLabel = new Intl.DateTimeFormat("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(starts);
    const timeFmt = new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const timeLabel = `${timeFmt.format(starts)} – ${timeFmt.format(ends)}`;
    const durationLabel = durationMinutes === 30 ? "30-minute session" : "1-hour session";

    const amount =
      booking.amount_cents != null
        ? new Intl.NumberFormat("en-AU", {
            style: "currency",
            currency: ((booking.currency as string | null) ?? "aud").toUpperCase(),
          }).format((booking.amount_cents as number) / 100)
        : undefined;

    const origin =
      process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ??
      process.env.SITE_URL?.replace(/\/$/, "") ??
      "https://princesspink90.com";
    const icsUrl = `${origin}/api/public/bookings/${booking.id}/ics`;
    const dashboardUrl = `${origin}/bookings`;

    const { enqueueTemplateEmail } = await import("@/lib/email/enqueue.server");
    // A fresh idempotency key for explicit resends lets the user trigger a new
    // confirmation email; the default key still deduplicates automatic sends.
    const idempotencyKey = data.resend
      ? `booking-confirm-${booking.id}-${crypto.randomUUID()}`
      : `booking-confirm-${booking.id}`;
    const result = await enqueueTemplateEmail({
      templateName: "booking-confirmation",
      recipientEmail: recipient,
      idempotencyKey,
      templateData: {
        dateLabel,
        timeLabel,
        durationLabel,
        partySize: (booking.party_size as number | null) ?? 1,
        amount,
        notes: (booking.notes as string | null) ?? undefined,
        bookingId: booking.id as string,
        icsUrl,
        dashboardUrl,
      },
    });

    return { success: result.success, reason: result.reason, messageId: result.messageId };
  });

/**
 * Send the private-room booking cancellation email. Called from the cancel
 * server function after the booking status flips to `cancelled`. Idempotent
 * per booking so a retried cancel action doesn't send twice.
 */
export const sendBookingCancelledEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { bookingId: string }) => {
    if (!/^[0-9a-f-]{36}$/i.test(data.bookingId)) throw new Error("Invalid bookingId");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { data: booking, error } = await context.supabase
      .from("private_room_bookings")
      .select(
        "id,starts_at,duration_minutes,status,amount_cents,currency,party_size,customer_email",
      )
      .eq("id", data.bookingId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!booking) return { success: false, reason: "not_found" as const };
    if (booking.status !== "cancelled") {
      return { success: false, reason: "not_cancelled" as const };
    }

    const claimEmail =
      (context.claims as { email?: string } | null | undefined)?.email ?? null;
    const recipient = (booking.customer_email as string | null) ?? claimEmail;
    if (!recipient) return { success: false, reason: "no_recipient" as const };

    const starts = new Date(booking.starts_at as string);
    const durationMinutes = booking.duration_minutes as number;
    const ends = new Date(starts.getTime() + durationMinutes * 60_000);

    const dateLabel = new Intl.DateTimeFormat("en-AU", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    }).format(starts);
    const timeFmt = new Intl.DateTimeFormat("en-AU", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    const timeLabel = `${timeFmt.format(starts)} – ${timeFmt.format(ends)}`;
    const durationLabel = durationMinutes === 30 ? "30-minute session" : "1-hour session";

    const amount =
      booking.amount_cents != null
        ? new Intl.NumberFormat("en-AU", {
            style: "currency",
            currency: ((booking.currency as string | null) ?? "aud").toUpperCase(),
          }).format((booking.amount_cents as number) / 100)
        : undefined;

    const origin =
      process.env.PUBLIC_APP_URL?.replace(/\/$/, "") ??
      process.env.SITE_URL?.replace(/\/$/, "") ??
      "https://princesspink90.com";
    const dashboardUrl = `${origin}/bookings`;

    const { enqueueTemplateEmail } = await import("@/lib/email/enqueue.server");
    const result = await enqueueTemplateEmail({
      templateName: "booking-cancelled",
      recipientEmail: recipient,
      idempotencyKey: `booking-cancelled-${booking.id}`,
      templateData: {
        dateLabel,
        timeLabel,
        durationLabel,
        partySize: (booking.party_size as number | null) ?? 1,
        amount,
        bookingId: booking.id as string,
        dashboardUrl,
      },
    });

    return { success: result.success, reason: result.reason, messageId: result.messageId };
  });

