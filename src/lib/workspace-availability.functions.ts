import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const UUID = /^[0-9a-f-]{36}$/i;
const TABLE = "workspace_slots";

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

export interface WorkspaceSlot {
  id: string;
  start_time: string;
  end_time: string;
  is_booked: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

/** Admin: list upcoming workspace slots (end_time >= now), ordered by start. */
export const listUpcomingWorkspaceSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const nowIso = new Date().toISOString();
    const { data, error } = await context.supabase
      .from(TABLE)
      .select("id,start_time,end_time,is_booked,notes,created_at,updated_at")
      .gte("end_time", nowIso)
      .order("start_time", { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as WorkspaceSlot[];
  });

/** Admin: create a workspace slot. */
export const createWorkspaceSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      startTime: string;
      endTime: string;
      isBooked?: boolean;
      notes?: string | null;
    }) => {
      if (!validIso(data.startTime)) throw new Error("Invalid startTime");
      if (!validIso(data.endTime)) throw new Error("Invalid endTime");
      if (new Date(data.endTime).getTime() <= new Date(data.startTime).getTime()) {
        throw new Error("End time must be after start time");
      }
      return data;
    },
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from(TABLE)
      .insert({
        start_time: data.startTime,
        end_time: data.endTime,
        is_booked: data.isBooked ?? false,
        notes: data.notes ?? null,
      })
      .select("id,start_time,end_time,is_booked,notes,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row as WorkspaceSlot;
  });

/** Admin: update a workspace slot. */
export const updateWorkspaceSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: {
      id: string;
      startTime?: string;
      endTime?: string;
      isBooked?: boolean;
      notes?: string | null;
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
    } = {};
    if (data.startTime !== undefined) patch.start_time = data.startTime;
    if (data.endTime !== undefined) patch.end_time = data.endTime;
    if (data.isBooked !== undefined) patch.is_booked = data.isBooked;
    if (data.notes !== undefined) patch.notes = data.notes;
    const { data: row, error } = await context.supabase
      .from(TABLE)
      .update(patch)
      .eq("id", data.id)
      .select("id,start_time,end_time,is_booked,notes,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row as WorkspaceSlot;
  });

/** Admin: delete a workspace slot. */
export const deleteWorkspaceSlot = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => {
    if (!UUID.test(data.id)) throw new Error("Invalid id");
    return data;
  })
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase.from(TABLE).delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/** Admin: bulk create workspace slots, skipping overlaps with existing rows. */
export const bulkCreateWorkspaceSlots = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (data: { slots: Array<{ startTime: string; endTime: string }> }) => {
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
      .from(TABLE)
      .select("start_time,end_time")
      .lt("start_time", windowEnd)
      .gt("end_time", windowStart);
    if (exErr) throw new Error(exErr.message);

    const existingRanges = (existing ?? []).map((r: any) => ({
      start: new Date(r.start_time).getTime(),
      end: new Date(r.end_time).getTime(),
    }));

    const toInsert: Array<{ start_time: string; end_time: string; is_booked: boolean }> = [];
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
      toInsert.push({ start_time: p.startIso, end_time: p.endIso, is_booked: false });
    }

    let created = 0;
    if (toInsert.length > 0) {
      const { error: insErr, count } = await context.supabase
        .from(TABLE)
        .insert(toInsert, { count: "exact" });
      if (insErr) throw new Error(insErr.message);
      created = count ?? toInsert.length;
    }

    return { created, skipped, total: proposed.length };
  });

/**
 * Public read: busy time ranges for the Secondary Room (Glory Holes) in
 * [from, to]. Combines confirmed/held private_room_bookings with any
 * workspace_slots the admin has marked as booked/blocked. Uses the admin
 * client because workspace_slots is admin-read-only (no PII exposed —
 * only start/end pairs).
 */
export const listWorkspaceBusy = createServerFn({ method: "GET" })
  .inputValidator((data: { from: string; to: string }) => {
    if (!data.from || !data.to) throw new Error("from/to required");
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin.rpc("get_private_room_busy", {
      from_ts: data.from,
      to_ts: data.to,
    });
    if (error) throw new Error(error.message);

    const { data: blocked, error: blockedErr } = await supabaseAdmin
      .from(TABLE)
      .select("start_time,end_time")
      .eq("is_booked", true)
      .lt("start_time", data.to)
      .gt("end_time", data.from);
    if (blockedErr) throw new Error(blockedErr.message);

    const busy = (rows ?? []) as Array<{ starts_at: string; duration_minutes: number }>;
    const blockedBusy = (blocked ?? []).map(
      (b: { start_time: string; end_time: string }) => {
        const starts = new Date(b.start_time);
        const ends = new Date(b.end_time);
        return {
          starts_at: b.start_time,
          duration_minutes: Math.max(
            1,
            Math.round((ends.getTime() - starts.getTime()) / 60000),
          ),
        };
      },
    );
    const combined: Array<{ starts_at: string; duration_minutes: number }> = [
      ...busy,
      ...blockedBusy,
    ];
    return combined;
  });

/**
 * Public read: admin-defined available windows for the Secondary Room
 * (Glory Holes) in [from, to]. Same shape/semantics as
 * listPrivateRoomAvailable.
 */
export const listWorkspaceAvailable = createServerFn({ method: "GET" })
  .inputValidator((data: { from: string; to: string }) => {
    if (!data.from || !data.to) throw new Error("from/to required");
    return data;
  })
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: rows, error } = await supabaseAdmin
      .from(TABLE)
      .select("start_time,end_time")
      .eq("is_booked", false)
      .lt("start_time", data.to)
      .gt("end_time", data.from);
    if (error) throw new Error(error.message);
    return (rows ?? []) as Array<{ start_time: string; end_time: string }>;
  });
