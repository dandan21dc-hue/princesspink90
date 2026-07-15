import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolveAppOrigin } from "@/lib/app-origin.server";

/**
 * Booking checkout for private-room and glory-holes.
 *
 * 1. Reads pricing/duration from site_settings server-side (client cannot
 *    influence what the user is charged).
 * 2. Inserts a `pending` row in `private_room_bookings` — the same table
 *    both booking pages already read for the busy grid, so held slots
 *    show up immediately in the availability lookup (15-minute pending
 *    window).
 * 3. Creates a NOWPayments hosted invoice with an order_id encoding the
 *    booking id. The IPN webhook flips the row to `confirmed` on
 *    `payment_status === 'finished'`, idempotently per NOWPayments
 *    `payment_id` (row's `external_payment_reference` column is UNIQUE).
 */
const inputSchema = z.object({
  environment: z.enum(["sandbox", "live"]),
  // `returnOrigin` is accepted for backwards compatibility with older
  // clients but is deliberately ignored — success/cancel/IPN URLs are
  // built from the server-verified app origin (see `resolveAppOrigin`).
  returnOrigin: z.string().url().optional(),
  roomType: z.enum(["private_room", "glory_hole"]),
  bookingStartsAt: z.string().datetime(),
  bookingNotes: z.string().max(1000).optional(),
  bookingPartySize: z.number().int().min(1).max(10).optional(),
  // Optional pre-checkout lead capture (e.g. from the concierge chat form).
  // Server still trusts the authenticated user id for authorization; these
  // are purely contact details persisted onto the booking row.
  customerName: z.string().trim().min(1).max(120).optional(),
  customerEmail: z.string().trim().email().max(255).optional(),
  customerPhone: z.string().trim().min(4).max(40).optional(),
});

type Success = { invoiceUrl: string; bookingId: string };
type Failure = { error: string };

const ROOM_LABEL: Record<"private_room" | "glory_hole", string> = {
  private_room: "Private Room",
  glory_hole: "Glory Holes",
};

export const createBookingInvoice = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => inputSchema.parse(data))
  .handler(async ({ data, context }): Promise<Success | Failure> => {
    try {
      const startsAt = new Date(data.bookingStartsAt);
      if (Number.isNaN(startsAt.getTime())) {
        return { error: "Invalid booking start time" };
      }
      if (startsAt.getTime() < Date.now() + 55 * 60 * 1000) {
        return { error: "Bookings need at least 1 hour lead time" };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

      // Server-side pricing lookup — never trust the client.
      const { data: settings } = await supabaseAdmin
        .from("site_settings")
        .select("session_price_cents, session_duration_minutes")
        .eq("id", "host")
        .maybeSingle();
      const priceCents = settings?.session_price_cents ?? 27500;
      const rawDuration = settings?.session_duration_minutes ?? 60;
      // Column is CHECK-constrained to (30, 60).
      const duration = rawDuration <= 30 ? 30 : 60;
      if (!priceCents || priceCents < 100) {
        return { error: "Booking price is not configured" };
      }

      // Reject overlapping conflicts server-side to avoid holding phantom
      // rows for slots that would fail at check-in.
      const endsAt = new Date(startsAt.getTime() + duration * 60_000);
      const { data: busy, error: busyErr } = await supabaseAdmin.rpc(
        "get_private_room_busy",
        { from_ts: startsAt.toISOString(), to_ts: endsAt.toISOString() },
      );
      if (busyErr) return { error: `Availability check failed: ${busyErr.message}` };
      if ((busy ?? []).length > 0) {
        return { error: "That time was just taken — please pick another slot." };
      }

      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(context.userId);
      const authEmail = authUser.user?.email ?? null;
      const customerEmail = data.customerEmail ?? authEmail;

      // Merge lead contact into the booking notes so admins see it on the
      // booking row (schema has no dedicated name/phone columns).
      const contactLines = [
        data.customerName ? `Name: ${data.customerName}` : null,
        data.customerPhone ? `Phone: ${data.customerPhone}` : null,
      ].filter(Boolean);
      const notesBody = data.bookingNotes?.trim() || null;
      const mergedNotes =
        contactLines.length > 0
          ? [contactLines.join(" · "), notesBody].filter(Boolean).join("\n")
          : notesBody;

      const { data: booking, error: insertErr } = await supabaseAdmin
        .from("private_room_bookings")
        .insert({
          user_id: context.userId,
          starts_at: startsAt.toISOString(),
          duration_minutes: duration,
          status: "pending",
          amount_cents: priceCents,
          currency: "aud",
          environment: data.environment,
          customer_email: customerEmail,
          notes: mergedNotes,
          party_size: data.bookingPartySize ?? null,
        })
        .select("id")
        .single();
      if (insertErr || !booking) {
        return { error: `Could not hold booking: ${insertErr?.message ?? "unknown error"}` };
      }

      const { createInvoice } = await import("@/lib/nowpayments.server");
      const orderId = `booking:${booking.id}:${context.userId}:${data.environment}:${priceCents}`;
      const humanTime = startsAt.toISOString().replace("T", " ").slice(0, 16);
      const description = `${ROOM_LABEL[data.roomType]} · ${duration} min · ${humanTime} UTC (Midnight Glory)`;

      try {
        const invoice = await createInvoice({
          priceAmount: priceCents / 100,
          priceCurrency: "aud",
          orderId,
          orderDescription: description,
          ipnCallbackUrl: `${data.returnOrigin}/api/public/payments/nowpayments-webhook`,
          successUrl: `${data.returnOrigin}/checkout/return?provider=nowpayments&status=success&next=%2Fdashboard`,
          cancelUrl: `${data.returnOrigin}/checkout/return?provider=nowpayments&status=cancel`,
        });
        return { invoiceUrl: invoice.invoice_url, bookingId: booking.id };
      } catch (e) {
        // Roll the pending hold back so the slot frees up immediately.
        await supabaseAdmin
          .from("private_room_bookings")
          .update({ status: "cancelled" })
          .eq("id", booking.id);
        return { error: (e as Error).message };
      }
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
