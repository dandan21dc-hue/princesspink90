import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

function validIso(s: string) {
  return typeof s === "string" && !Number.isNaN(Date.parse(s));
}

export interface PrivateSessionSlot {
  id: string;
  start_time: string;
  end_time: string;
  is_booked: boolean;
  notes: string | null;
  /** Session length in minutes. Derived from start/end for legacy rows;
   *  stored explicitly on rows created after the duration/price feature. */
  duration_minutes: number | null;
  /** Session price in AUD cents. Null = "not set" (inherits site default). */
  price_cents: number | null;
  created_at: string;
  updated_at: string;
}

const SLOT_COLS =
  "id,start_time,end_time,is_booked,notes,duration_minutes,price_cents,created_at,updated_at";

function derivedDurationMinutes(startIso: string, endIso: string) {
  return Math.max(
    1,
    Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / 60000),
  );
}

function validPriceCents(v: unknown): v is number | null {
  if (v === null || v === undefined) return true;
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v >= 0;
}

function validDurationMinutes(v: unknown): v is number | null {
  if (v === null || v === undefined) return true;
  return typeof v === "number" && Number.isFinite(v) && Number.isInteger(v) && v > 0;
}

/** Admin: list upcoming session slots (end_time >= now), ordered by start. */
export const listUpcomingSessionSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const nowIso = new Date().toISOString();
    const { data, error } = await context.supabase
      .from("private_session_slots")
      .select(SLOT_COLS)
      .gte("end_time", nowIso)
      .order("start_time", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as PrivateSessionSlot[];
  });

/** Admin: create a new slot. */
export const createSessionSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      startTime: string;
      endTime: string;
      isBooked?: boolean;
      notes?: string | null;
      durationMinutes?: number | null;
      priceCents?: number | null;
    }) => {
      if (!validIso(data.startTime)) throw new Error("Invalid startTime");
      if (!validIso(data.endTime)) throw new Error("Invalid endTime");
      if (new Date(data.endTime).getTime() <= new Date(data.startTime).getTime()) {
        throw new Error("End time must be after start time");
      }
      if (!validDurationMinutes(data.durationMinutes)) {
        throw new Error("Invalid durationMinutes");
      }
      if (!validPriceCents(data.priceCents)) {
        throw new Error("Invalid priceCents");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("private_session_slots")
      .insert({
        start_time: data.startTime,
        end_time: data.endTime,
        is_booked: data.isBooked ?? false,
        notes: data.notes ?? null,
        duration_minutes:
          data.durationMinutes ?? derivedDurationMinutes(data.startTime, data.endTime),
        price_cents: data.priceCents ?? null,
      })
      .select(SLOT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return row as PrivateSessionSlot;
  });

/** Admin: update a slot (times, booked/available, notes, duration, price). */
export const updateSessionSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id: string;
      startTime?: string;
      endTime?: string;
      isBooked?: boolean;
      notes?: string | null;
      durationMinutes?: number | null;
      priceCents?: number | null;
    }) => {
      if (!UUID.test(data.id)) throw new Error("Invalid id");
      if (data.startTime !== undefined && !validIso(data.startTime))
        throw new Error("Invalid startTime");
      if (data.endTime !== undefined && !validIso(data.endTime))
        throw new Error("Invalid endTime");
      if (
        data.startTime !== undefined &&
        data.endTime !== undefined &&
        new Date(data.endTime).getTime() <= new Date(data.startTime).getTime()
      ) {
        throw new Error("End time must be after start time");
      }
      if (data.durationMinutes !== undefined && !validDurationMinutes(data.durationMinutes)) {
        throw new Error("Invalid durationMinutes");
      }
      if (data.priceCents !== undefined && !validPriceCents(data.priceCents)) {
        throw new Error("Invalid priceCents");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const patch: {
      start_time?: string;
      end_time?: string;
      is_booked?: boolean;
      notes?: string | null;
      duration_minutes?: number | null;
      price_cents?: number | null;
    } = {};
    if (data.startTime !== undefined) patch.start_time = data.startTime;
    if (data.endTime !== undefined) patch.end_time = data.endTime;
    if (data.isBooked !== undefined) patch.is_booked = data.isBooked;
    if (data.notes !== undefined) patch.notes = data.notes;
    if (data.durationMinutes !== undefined) patch.duration_minutes = data.durationMinutes;
    if (data.priceCents !== undefined) patch.price_cents = data.priceCents;
    const { data: row, error } = await context.supabase
      .from("private_session_slots")
      .update(patch)
      .eq("id", data.id)
      .select(SLOT_COLS)
      .single();
    if (error) throw new Error(error.message);
    return row as PrivateSessionSlot;
  });


/** Admin: delete a slot. */
export const deleteSessionSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!UUID.test(data.id)) throw new Error("Invalid id");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("private_session_slots")
      .delete()
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * Public read: admin-defined available windows for the Private Room in
 * [from, to]. Returned as raw start/end pairs — the customer picker only
 * offers times that fit fully inside one of these windows. If empty for a
 * day, that day has no bookable time.
 * Uses the admin client because private_session_slots is admin-read-only
 * (only start/end pairs exposed, no PII).
 */
export const listPrivateRoomAvailable = createServerFn({ method: "GET" })
  .inputValidator((data: { from: string; to: string }) => {
    if (!data.from || !data.to) throw new Error("from/to required");
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from("private_session_slots")
      .select("start_time,end_time")
      .eq("is_booked", false)
      .lt("start_time", data.to)
      .gt("end_time", data.from);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ start_time: string; end_time: string }>;
  });

/**
 * Admin: bulk-insert a batch of proposed slots.
 * Any proposed slot that overlaps an existing slot in the covered window
 * (booked or available) is skipped — this treats existing rows as the
 * "closed / unavailable" markers for the range.
 */
export const bulkCreateSessionSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      slots: Array<{ startTime: string; endTime: string }>;
      durationMinutes?: number | null;
      priceCents?: number | null;
    }) => {
      if (!Array.isArray(data?.slots) || data.slots.length === 0) {
        throw new Error("No slots to create");
      }
      if (data.slots.length > 500) throw new Error("Too many slots (max 500)");
      for (const s of data.slots) {
        if (!validIso(s.startTime) || !validIso(s.endTime)) {
          throw new Error("Invalid slot time");
        }
        if (new Date(s.endTime).getTime() <= new Date(s.startTime).getTime()) {
          throw new Error("End time must be after start time");
        }
      }
      if (!validDurationMinutes(data.durationMinutes)) {
        throw new Error("Invalid durationMinutes");
      }
      if (!validPriceCents(data.priceCents)) {
        throw new Error("Invalid priceCents");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const proposed = data.slots
      .map((s) => ({
        start: new Date(s.startTime).getTime(),
        end: new Date(s.endTime).getTime(),
        startIso: s.startTime,
        endIso: s.endTime,
      }))
      .sort((a, b) => a.start - b.start);

    const windowStart = new Date(proposed[0].start).toISOString();
    const windowEnd = new Date(proposed[proposed.length - 1].end).toISOString();

    const { data: existing, error: exErr } = await context.supabase
      .from("private_session_slots")
      .select("start_time,end_time")
      .lt("start_time", windowEnd)
      .gt("end_time", windowStart);
    if (exErr) throw new Error(exErr.message);

    const existingRanges = (existing ?? []).map((r: any) => ({
      start: new Date(r.start_time).getTime(),
      end: new Date(r.end_time).getTime(),
    }));

    const toInsert: Array<{
      start_time: string;
      end_time: string;
      is_booked: boolean;
      duration_minutes: number;
      price_cents: number | null;
    }> = [];
    let skipped = 0;
    const accepted: Array<{ start: number; end: number }> = [];
    const overlaps = (
      a: { start: number; end: number },
      b: { start: number; end: number },
    ) => a.start < b.end && b.start < a.end;

    for (const p of proposed) {
      const clash =
        existingRanges.some((r) => overlaps(p, r)) ||
        accepted.some((r) => overlaps(p, r));
      if (clash) {
        skipped++;
        continue;
      }
      accepted.push({ start: p.start, end: p.end });
      toInsert.push({
        start_time: p.startIso,
        end_time: p.endIso,
        is_booked: false,
        duration_minutes:
          data.durationMinutes ?? derivedDurationMinutes(p.startIso, p.endIso),
        price_cents: data.priceCents ?? null,
      });
    }

    let created = 0;
    if (toInsert.length > 0) {
      const { error: insErr, count } = await context.supabase
        .from("private_session_slots")
        .insert(toInsert, { count: "exact" });
      if (insErr) throw new Error(insErr.message);
      created = count ?? toInsert.length;
    }

    return { created, skipped, total: proposed.length };
  });
