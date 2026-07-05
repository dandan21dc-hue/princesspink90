import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const eventInput = z.object({
  title: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  venue_name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  starts_at: z.string().min(1),
  ends_at: z.string().optional().nullable(),
  dress_code: z.string().trim().max(120).optional().nullable(),
  theme: z.string().trim().max(120).optional().nullable(),
  capacity: z.number().int().positive().max(10000).optional().nullable(),
  ticket_price_cents: z.number().int().min(0).max(10_000_00).default(0),
  cover_image_url: z.string().url().max(500).optional().nullable(),
  is_private: z.boolean().default(false),
  published: z.boolean().default(true),
});

export const listMyEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("events")
      .select("id, title, starts_at, venue_name, is_private, published, cover_image_url")
      .eq("host_id", context.userId)
      .order("starts_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getMyEvent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: event, error } = await context.supabase
      .from("events")
      .select("*")
      .eq("id", data.id)
      .eq("host_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!event) throw new Error("Not found");
    const { data: codes } = await context.supabase
      .from("event_access_codes")
      .select("*")
      .eq("event_id", data.id)
      .order("created_at");
    const { data: rsvpsRaw } = await context.supabase
      .from("rsvps")
      .select("id, user_id, guest_count, ticket_code, status, created_at")
      .eq("event_id", data.id)
      .order("created_at", { ascending: false });
    const userIds = (rsvpsRaw ?? []).map((r) => r.user_id);
    const { data: profs } = userIds.length
      ? await context.supabase.from("profiles").select("user_id, display_name").in("user_id", userIds)
      : { data: [] as { user_id: string; display_name: string | null }[] };
    const nameByUser = new Map((profs ?? []).map((p) => [p.user_id, p.display_name]));
    const rsvps = (rsvpsRaw ?? []).map((r) => ({ ...r, display_name: nameByUser.get(r.user_id) ?? null }));
    return { event, codes: codes ?? [], rsvps };
  });

export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof eventInput>) => eventInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("events")
      .insert({ ...data, host_id: context.userId })
      .select("id")
      .single();
    if (error) throw error;
    return row;
  });

export const updateEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string } & z.infer<typeof eventInput>) =>
    z.object({ id: z.string().uuid() }).and(eventInput).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { id, ...update } = data;
    const { error } = await context.supabase
      .from("events")
      .update(update)
      .eq("id", id)
      .eq("host_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("events")
      .delete()
      .eq("id", data.id)
      .eq("host_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const addAccessCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string; code: string; note?: string }) =>
    z.object({
      event_id: z.string().uuid(),
      code: z.string().trim().min(3).max(64),
      note: z.string().trim().max(120).optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Verify ownership
    const { data: owned } = await context.supabase
      .from("events")
      .select("id")
      .eq("id", data.event_id)
      .eq("host_id", context.userId)
      .maybeSingle();
    if (!owned) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("event_access_codes")
      .insert({ event_id: data.event_id, code: data.code, note: data.note ?? null });
    if (error) throw error;
    return { ok: true };
  });

export const deleteAccessCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // RLS on event_access_codes checks event ownership
    const { error } = await context.supabase.from("event_access_codes").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

const markUsedSchema = z.object({
  used: z.boolean(),
  used_by_name: z.string().trim().max(120).optional(),
}).superRefine((v, ctx) => {
  if (v.used && !v.used_by_name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["used_by_name"], message: "Guest name is required when marking a code as used" });
  }
});

export const setAccessCodeUsed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; used: boolean; used_by_name?: string }) =>
    z.object({ id: z.string().uuid() }).and(markUsedSchema).parse(data),
  )
  .handler(async ({ data, context }) => {
    const patch = data.used
      ? { used_at: new Date().toISOString(), used_by_name: data.used_by_name!.trim() }
      : { used_at: null, used_by_name: null };
    const { error } = await context.supabase
      .from("event_access_codes").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const bulkSetAccessCodesUsed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[]; used: boolean; used_by_name?: string }) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).and(markUsedSchema).parse(data),
  )
  .handler(async ({ data, context }) => {
    const patch = data.used
      ? { used_at: new Date().toISOString(), used_by_name: data.used_by_name!.trim() }
      : { used_at: null, used_by_name: null };
    const { error, count } = await context.supabase
      .from("event_access_codes").update(patch, { count: "exact" }).in("id", data.ids);
    if (error) throw error;
    return { ok: true, count: count ?? data.ids.length };
  });

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randCode(prefix: string, len: number) {
  let s = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}-${s}`;
}

export const updateAccessCodeGuestName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; used_by_name: string }) =>
    z.object({
      id: z.string().uuid(),
      used_by_name: z.string().trim().min(1, "Guest name is required").max(120),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Only allow editing the name on codes that are already marked used.
    const { data: row, error: readErr } = await context.supabase
      .from("event_access_codes")
      .select("id, used_at")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) throw new Error("Not found");
    if (!row.used_at) throw new Error("Code is not marked as used");
    const { error } = await context.supabase
      .from("event_access_codes")
      .update({ used_by_name: data.used_by_name.trim() })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const bulkAddAccessCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string; quantity: number; prefix?: string; note?: string; length?: number }) =>
    z.object({
      event_id: z.string().uuid(),
      quantity: z.number().int().min(1).max(200),
      prefix: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9]+$/).default("PINK"),
      note: z.string().trim().max(120).optional(),
      length: z.number().int().min(4).max(12).default(6),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: owned } = await context.supabase
      .from("events").select("id").eq("id", data.event_id).eq("host_id", context.userId).maybeSingle();
    if (!owned) throw new Error("Forbidden");
    const prefix = data.prefix.toUpperCase();
    const seen = new Set<string>();
    const rows = Array.from({ length: data.quantity }, () => {
      let code = randCode(prefix, data.length);
      while (seen.has(code)) code = randCode(prefix, data.length);
      seen.add(code);
      return { event_id: data.event_id, code, note: data.note ?? null };
    });
    const { data: inserted, error } = await context.supabase
      .from("event_access_codes").insert(rows).select("id, code");
    if (error) throw error;
    return { ok: true, codes: inserted ?? [] };
  });
