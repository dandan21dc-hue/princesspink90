import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { videoConsentSchema, type VideoConsent } from "@/lib/verification.functions";

export const rsvpToEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    event_id: string;
    guest_count?: number;
    age_confirmed: boolean;
    video_consent: VideoConsent;
  }) =>
    z.object({
      event_id: z.string().uuid(),
      guest_count: z.number().int().min(1).max(10).default(1),
      age_confirmed: z.literal(true, {
        errorMap: () => ({ message: "You must confirm you are 18+." }),
      }),
      video_consent: videoConsentSchema,
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Require an approved age verification on file
    const { data: av } = await context.supabase
      .from("age_verifications")
      .select("status")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!av || av.status !== "approved") {
      throw new Error(
        av?.status === "pending"
          ? "Your ID is still under review — you'll be able to RSVP once approved."
          : "Please submit ID for age verification before RSVPing.",
      );
    }

    const now = new Date().toISOString();
    const { data: row, error } = await context.supabase
      .from("rsvps")
      .upsert(
        {
          event_id: data.event_id,
          user_id: context.userId,
          guest_count: data.guest_count,
          status: "confirmed",
          age_confirmed_at: now,
          consent_confirmed_at: now,
          video_consent: data.video_consent,
        },
        { onConflict: "event_id,user_id" },
      )
      .select("ticket_code")
      .single();
    if (error) throw error;

    // Auto-redeem lifetime member's free event ticket on first RSVP
    const env = process.env.NODE_ENV === "production" ? "live" : "sandbox";
    const { data: mem } = await context.supabase
      .from("memberships")
      .select("id, event_ticket_used_at")
      .eq("user_id", context.userId)
      .eq("environment", env)
      .eq("kind", "lifetime")
      .maybeSingle();
    if (mem && !mem.event_ticket_used_at) {
      await context.supabase
        .from("memberships")
        .update({
          event_ticket_used_at: now,
          event_ticket_event_id: data.event_id,
        })
        .eq("id", mem.id);
    }
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
      .select("ticket_code, guest_count, status, video_consent, age_confirmed_at, consent_confirmed_at")
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
