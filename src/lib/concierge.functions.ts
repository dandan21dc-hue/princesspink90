import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { createBookingInvoice } from "@/lib/bookingInvoice.functions";

/**
 * Booking Concierge — server APIs exposed to the in-app chat widget.
 *
 * Two responsibilities:
 *   1) Read real-time Private Room availability so the chat can propose
 *      concrete slots.
 *   2) Kick off the standard "Create Booking" workflow (NOWPayments hosted
 *      invoice → IPN → `private_room_bookings` row flips to `confirmed`)
 *      from inside the chat, reusing the exact server code the /private-room
 *      page uses so pricing, lead-time, and conflict rules stay consistent.
 *
 * The concierge does NOT do checks in code the DB doesn't already enforce.
 * All time/pricing validation lives in `createBookingInvoice` and the RPC
 * `get_private_room_busy`.
 */

const SLOT_STEP_MIN = 30;
const MIN_LEAD_MIN = 60; // Match createBookingInvoice's 55-minute floor + buffer.
const MAX_HORIZON_DAYS = 30;

const listInput = z.object({
  /** ISO datetime to search from; defaults to now server-side. */
  fromIso: z.string().datetime().optional(),
  /** How many days forward to scan (1..30). */
  horizonDays: z.number().int().min(1).max(MAX_HORIZON_DAYS).default(7),
  /** How many candidate slots to return (1..12). */
  limit: z.number().int().min(1).max(12).default(6),
  /** Booking duration in minutes; must match a value allowed by site_settings. */
  durationMinutes: z.union([z.literal(30), z.literal(60)]).default(60),
});

export type ConciergeSlot = {
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
};

/**
 * Public: enumerate the next `limit` bookable Private Room slots inside
 * the admin-defined available windows, skipping anything currently held or
 * confirmed. Safe to call unauthenticated because availability itself is
 * public (no PII).
 */
export const listConciergeSlots = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => listInput.parse(data ?? {}))
  .handler(async ({ data }): Promise<ConciergeSlot[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const fromMs = Math.max(
      data.fromIso ? new Date(data.fromIso).getTime() : Date.now(),
      Date.now() + MIN_LEAD_MIN * 60_000,
    );
    const toMs = Date.now() + data.horizonDays * 24 * 60 * 60_000;
    const fromIso = new Date(fromMs).toISOString();
    const toIso = new Date(toMs).toISOString();

    const [windowsRes, busyRes] = await Promise.all([
      supabaseAdmin
        .from("private_session_slots")
        .select("start_time,end_time")
        .eq("is_booked", false)
        .lt("start_time", toIso)
        .gt("end_time", fromIso),
      supabaseAdmin.rpc("get_private_room_busy", { from_ts: fromIso, to_ts: toIso }),
    ]);
    if (windowsRes.error) throw new Error(windowsRes.error.message);
    if (busyRes.error) throw new Error(busyRes.error.message);

    const busy = (busyRes.data ?? []).map((b) => {
      const start = new Date(b.starts_at).getTime();
      return { start, end: start + b.duration_minutes * 60_000 };
    });
    const windows = (windowsRes.data ?? [])
      .map((w) => ({
        start: new Date(w.start_time).getTime(),
        end: new Date(w.end_time).getTime(),
      }))
      .sort((a, b) => a.start - b.start);

    const stepMs = SLOT_STEP_MIN * 60_000;
    const durationMs = data.durationMinutes * 60_000;
    const out: ConciergeSlot[] = [];
    for (const w of windows) {
      let cand = Math.max(Math.ceil(w.start / stepMs) * stepMs, fromMs);
      while (cand + durationMs <= w.end && out.length < data.limit) {
        const end = cand + durationMs;
        const conflict = busy.some((b) => b.start < end && b.end > cand);
        if (!conflict) {
          out.push({
            startsAt: new Date(cand).toISOString(),
            endsAt: new Date(end).toISOString(),
            durationMinutes: data.durationMinutes,
          });
        }
        cand += stepMs;
      }
      if (out.length >= data.limit) break;
    }
    return out;
  });

const startInput = z.object({
  startsAt: z.string().datetime(),
  notes: z.string().max(1000).optional(),
  returnOrigin: z.string().url(),
});

/**
 * Auth-required: start the Create Booking workflow for a chat-selected slot.
 * Thin wrapper around `createBookingInvoice` so the chat has a single,
 * concierge-scoped API (fixed `roomType`, party size, environment) instead
 * of duplicating booking-invoice knowledge on the client.
 */
export const startConciergeBooking = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => startInput.parse(data))
  .handler(async ({ data }) => {
    const environment = (process.env.NODE_ENV === "production" ? "live" : "sandbox") as
      | "sandbox"
      | "live";
    // Reuse the exact server-side booking workflow used by /private-room.
    return createBookingInvoice({
      data: {
        environment,
        returnOrigin: data.returnOrigin,
        roomType: "private_room",
        bookingStartsAt: data.startsAt,
        bookingNotes: data.notes,
        bookingPartySize: 1,
      },
    });
  });
