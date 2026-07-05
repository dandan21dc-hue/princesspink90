import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { videoConsentSchema, type VideoConsent } from "@/lib/verification.functions";

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const rsvpToEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    event_id: string;
    guest_count?: number;
    age_confirmed: boolean;
    video_consent: VideoConsent;
    waiver_accepted: boolean;
    waiver_signature: string;
    waiver_text_hash: string;
  }) =>
    z.object({
      event_id: z.string().uuid(),
      guest_count: z.number().int().min(1).max(10).default(1),
      age_confirmed: z.literal(true, {
        errorMap: () => ({ message: "You must confirm you are 18+." }),
      }),
      video_consent: videoConsentSchema,
      waiver_accepted: z.literal(true, {
        errorMap: () => ({ message: "You must accept the liability waiver to RSVP." }),
      }),
      waiver_signature: z.string().trim().min(2, "Type your full legal name to sign.").max(120),
      waiver_text_hash: z.string().regex(/^[a-f0-9]{64}$/, "Waiver signature is invalid — please refresh."),
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

    // Verify the guest signed the CURRENT waiver text (not a stale cached copy).
    const { data: evRow, error: evErr } = await context.supabase
      .from("events")
      .select("waiver_text")
      .eq("id", data.event_id)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!evRow) throw new Error("Event not found.");
    const currentHash = await sha256Hex((evRow.waiver_text ?? "").trim());
    if (currentHash !== data.waiver_text_hash) {
      throw new Error("The waiver was updated. Please review and sign again.");
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
          waiver_signature: data.waiver_signature.trim(),
          waiver_accepted_at: now,
          waiver_text_hash: currentHash,
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
      .select("ticket_code, guest_count, status, video_consent, age_confirmed_at, consent_confirmed_at, waiver_signature, waiver_accepted_at")
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
