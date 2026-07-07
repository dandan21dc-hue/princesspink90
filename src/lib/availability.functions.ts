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
  created_at: string;
  updated_at: string;
}

/** Admin: list upcoming session slots (end_time >= now), ordered by start. */
export const listUpcomingSessionSlots = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const nowIso = new Date().toISOString();
    const { data, error } = await context.supabase
      .from("private_session_slots")
      .select("id,start_time,end_time,is_booked,notes,created_at,updated_at")
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
      .from("private_session_slots")
      .insert({
        start_time: data.startTime,
        end_time: data.endTime,
        is_booked: data.isBooked ?? false,
        notes: data.notes ?? null,
      })
      .select("id,start_time,end_time,is_booked,notes,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row as PrivateSessionSlot;
  });

/** Admin: update a slot (times, booked/available, notes). */
export const updateSessionSlot = createServerFn({ method: "POST" })
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
      .from("private_session_slots")
      .update(patch)
      .eq("id", data.id)
      .select("id,start_time,end_time,is_booked,notes,created_at,updated_at")
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
