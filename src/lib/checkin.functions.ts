import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { videoConsentSchema, type VideoConsent } from "@/lib/verification.functions";

async function assertEventHostOrAdmin(
  supabase: any,
  userId: string,
  eventId: string,
) {
  const { data: ev } = await supabase
    .from("events")
    .select("host_id")
    .eq("id", eventId)
    .maybeSingle();
  if (!ev) throw new Error("Event not found.");
  if (ev.host_id === userId) return;
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (!isAdmin) throw new Error("Only the event host can run door check-in.");
}

/** Look up a guest by ticket code for a given event (host/admin only). */
export const lookupCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { event_id: string; ticket_code: string }) =>
    z.object({
      event_id: z.string().uuid(),
      ticket_code: z.string().trim().min(3).max(50),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertEventHostOrAdmin(context.supabase, context.userId, data.event_id);
    const code = data.ticket_code.trim().toUpperCase();

    // Match either the scan-code (ticket_code) or the human-readable entry_code.
    const { data: rsvp, error } = await context.supabase
      .from("rsvps")
      .select(
        "id, user_id, ticket_code, entry_code, entry_phrase, guest_count, status, video_consent, checked_in_at, door_notes",
      )
      .eq("event_id", data.event_id)
      .or(`ticket_code.eq.${code},entry_code.eq.${code}`)
      .maybeSingle();
    if (error) throw error;
    if (!rsvp) return { found: false as const };

    // Load profile + age verification via admin-scoped queries (host can't
    // read other users' profiles/verifications directly).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [{ data: prof }, { data: av }, { data: authUser }] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("user_id", rsvp.user_id)
        .maybeSingle(),
      supabaseAdmin
        .from("age_verifications")
        .select("status, date_of_birth, reviewed_at")
        .eq("user_id", rsvp.user_id)
        .maybeSingle(),
      supabaseAdmin.auth.admin.getUserById(rsvp.user_id),
    ]);

    return {
      found: true as const,
      rsvp,
      guest: {
        display_name: prof?.display_name ?? null,
        email: authUser?.user?.email ?? null,
      },
      age: av
        ? {
            status: av.status,
            date_of_birth: av.date_of_birth,
            reviewed_at: av.reviewed_at,
          }
        : null,
    };
  });

/** Mark the RSVP checked-in with a re-confirmed consent snapshot. */
export const performCheckin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: {
      rsvp_id: string;
      event_id: string;
      consent: VideoConsent;
      door_notes?: string;
    }) =>
      z.object({
        rsvp_id: z.string().uuid(),
        event_id: z.string().uuid(),
        consent: videoConsentSchema,
        door_notes: z.string().trim().max(500).optional(),
      }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertEventHostOrAdmin(context.supabase, context.userId, data.event_id);

    // Verify age still approved (defence in depth — RSVP flow already gates this)
    const { data: rsvp } = await context.supabase
      .from("rsvps")
      .select("user_id, event_id")
      .eq("id", data.rsvp_id)
      .maybeSingle();
    if (!rsvp || rsvp.event_id !== data.event_id) throw new Error("RSVP not found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: av } = await supabaseAdmin
      .from("age_verifications")
      .select("status")
      .eq("user_id", rsvp.user_id)
      .maybeSingle();
    if (!av || av.status !== "approved") {
      throw new Error("Guest is not age-verified — do not admit.");
    }

    const { error } = await context.supabase
      .from("rsvps")
      .update({
        checked_in_at: new Date().toISOString(),
        checked_in_by: context.userId,
        video_consent: data.consent,
        consent_at_checkin: data.consent,
        door_notes: data.door_notes ?? null,
      })
      .eq("id", data.rsvp_id);
    if (error) throw error;
    return { ok: true };
  });

/** Live roster of checked-in guests for an event (host/admin only). */
export const listCheckins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { event_id: string }) =>
    z.object({ event_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertEventHostOrAdmin(context.supabase, context.userId, data.event_id);

    const { data: rows, error } = await context.supabase
      .from("rsvps")
      .select(
        "id, user_id, ticket_code, entry_code, entry_phrase, guest_count, checked_in_at, consent_at_checkin, video_consent, door_notes",
      )
      .eq("event_id", data.event_id)
      .not("checked_in_at", "is", null)
      .order("checked_in_at", { ascending: false });
    if (error) throw error;

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let nameByUser = new Map<string, string | null>();
    if (userIds.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profs } = await supabaseAdmin
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      nameByUser = new Map((profs ?? []).map((p) => [p.user_id, p.display_name]));
    }

    const guests = (rows ?? []).map((r) => ({
      id: r.id,
      ticket_code: r.ticket_code,
      entry_code: r.entry_code,
      entry_phrase: r.entry_phrase,
      guest_count: r.guest_count,
      checked_in_at: r.checked_in_at as string,
      display_name: nameByUser.get(r.user_id) ?? null,
      consent: (r.consent_at_checkin ?? r.video_consent) as VideoConsent | null,
      door_notes: r.door_notes as string | null,
    }));

    const total_heads = guests.reduce((sum, g) => sum + (g.guest_count ?? 1), 0);
    return { guests, total_heads };
  });

/** Full door admission sheet for printing (host/admin only). */
export const getDoorSheet = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { event_id: string }) =>
    z.object({ event_id: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await assertEventHostOrAdmin(context.supabase, context.userId, data.event_id);

    const { data: event, error: evErr } = await context.supabase
      .from("events")
      .select("id, title, starts_at, venue_name, address, city, dress_code")
      .eq("id", data.event_id)
      .maybeSingle();
    if (evErr) throw evErr;
    if (!event) throw new Error("Event not found.");

    const { data: rows, error } = await context.supabase
      .from("rsvps")
      .select(
        "id, user_id, ticket_code, entry_code, guest_count, status, video_consent, checked_in_at",
      )
      .eq("event_id", data.event_id)
      .eq("status", "confirmed")
      .order("entry_code", { ascending: true });
    if (error) throw error;

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    let nameByUser = new Map<string, string | null>();
    let ageByUser = new Map<string, string | null>();
    if (userIds.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [{ data: profs }, { data: avs }] = await Promise.all([
        supabaseAdmin.from("profiles").select("user_id, display_name").in("user_id", userIds),
        supabaseAdmin.from("age_verifications").select("user_id, status").in("user_id", userIds),
      ]);
      nameByUser = new Map((profs ?? []).map((p) => [p.user_id, p.display_name]));
      ageByUser = new Map((avs ?? []).map((a) => [a.user_id, a.status]));
    }

    const guests = (rows ?? []).map((r) => ({
      id: r.id,
      ticket_code: r.ticket_code,
      entry_code: r.entry_code,
      guest_count: r.guest_count,
      display_name: nameByUser.get(r.user_id) ?? null,
      age_status: ageByUser.get(r.user_id) ?? "missing",
      consent: (r.video_consent ?? null) as VideoConsent | null,
      already_checked_in: !!r.checked_in_at,
    }));

    const total_heads = guests.reduce((s, g) => s + (g.guest_count ?? 1), 0);
    return { event, guests, total_heads };
  });
