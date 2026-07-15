import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

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


/**
 * The chat widget triggers the actual booking by calling
 * `createBookingInvoice` from `@/lib/bookingInvoice.functions` directly with
 * `roomType: "private_room"` and the concierge-selected slot. That server
 * function already:
 *   - Requires the user to be signed in (Supabase auth middleware).
 *   - Reads pricing/duration from `site_settings` server-side.
 *   - Enforces the 1-hour lead time.
 *   - Rechecks `get_private_room_busy` to reject stolen slots.
 *   - Inserts the `pending` `private_room_bookings` row + returns the
 *     NOWPayments invoice URL that the IPN webhook flips to `confirmed`.
 *
 * We intentionally do NOT wrap it in a second concierge-scoped server
 * function: TanStack's server-fn RPC boundary makes chaining server fns
 * from within another handler brittle, and duplicating the logic here
 * would drift out of sync with the /private-room page.
 */

export type ConciergeBookingStatus = {
  id: string;
  status: string;
  startsAt: string;
  updatedAt: string;
};

/**
 * Reconcile booking cards the widget re-hydrates from persisted history
 * with the current DB state. RLS scopes rows to the caller.
 *
 * Called on chat mount to catch the "user came back from checkout" case
 * where a status change happened while the tab was gone and no realtime
 * event was received.
 */
export const getConciergeBookingStatuses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ bookingIds: z.array(z.string().uuid()).max(50) }).parse(data),
  )
  .handler(async ({ data, context }): Promise<ConciergeBookingStatus[]> => {
    if (data.bookingIds.length === 0) return [];
    const { data: rows, error } = await context.supabase
      .from("private_room_bookings")
      .select("id, status, starts_at, updated_at")
      .in("id", data.bookingIds);
    if (error) throw new Error(error.message);
    return (rows ?? []).map((r) => ({
      id: r.id as string,
      status: r.status as string,
      startsAt: r.starts_at as string,
      updatedAt: r.updated_at as string,
    }));
  });


