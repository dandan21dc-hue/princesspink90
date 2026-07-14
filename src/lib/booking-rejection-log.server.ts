/**
 * Server-only helper that records a rejected private-room booking attempt
 * to `booking_rejection_log`. Called from create-checkout and reschedule
 * server functions right before the code throws the user-facing error.
 *
 * All writes use the service-role client and never throw — a logging
 * failure must not block the rejection response that the user is about to
 * see.
 */

type AttemptKind = "create" | "reschedule_self" | "reschedule_admin";

interface LogArgs {
  attemptKind: AttemptKind;
  userId?: string | null;
  attemptedStartsAt?: string | null;
  durationMinutes?: number | null;
  reasonCode: string;
  reasonMessage: string;
  bookingId?: string | null;
  conflictBookingIds?: string[];
  metadata?: Record<string, unknown>;
}

export async function logBookingRejection(args: LogArgs): Promise<void> {
  try {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("booking_rejection_log").insert({
      attempt_kind: args.attemptKind,
      user_id: args.userId ?? null,
      attempted_starts_at: args.attemptedStartsAt ?? null,
      duration_minutes: args.durationMinutes ?? null,
      reason_code: args.reasonCode,
      reason_message: args.reasonMessage,
      booking_id: args.bookingId ?? null,
      conflict_booking_ids: args.conflictBookingIds ?? [],
      metadata: args.metadata ?? {},
    });
    if (error) {
      console.error("[logBookingRejection] insert failed", error.message);
    }
  } catch (e) {
    console.error("[logBookingRejection] unexpected error", e);
  }
}
