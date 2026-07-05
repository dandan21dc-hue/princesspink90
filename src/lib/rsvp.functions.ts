import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export const rsvpToEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string; guest_count?: number }) =>
    z.object({
      event_id: z.string().uuid(),
      guest_count: z.number().int().min(1).max(10).default(1),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("rsvps")
      .upsert(
        { event_id: data.event_id, user_id: context.userId, guest_count: data.guest_count, status: "confirmed" },
        { onConflict: "event_id,user_id" },
      )
      .select("ticket_code")
      .single();
    if (error) throw error;
    return row;
  });

export const cancelRsvp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string }) =>
    z.object({ event_id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("rsvps")
      .delete()
      .eq("event_id", data.event_id)
      .eq("user_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const myRsvpForEvent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string }) =>
    z.object({ event_id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: row } = await context.supabase
      .from("rsvps")
      .select("ticket_code, guest_count, status")
      .eq("event_id", data.event_id)
      .eq("user_id", context.userId)
      .maybeSingle();
    return row;
  });

export const listMyRsvps = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("rsvps")
      .select("id, ticket_code, guest_count, status, created_at, events(id, title, starts_at, venue_name, city, cover_image_url)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });
