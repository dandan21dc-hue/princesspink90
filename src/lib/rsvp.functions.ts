import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { videoConsentSchema, type VideoConsent } from "@/lib/verification.functions";
import { normalizeEntryPhrase } from "@/lib/entry-phrase";
import { assertAccountNotRestricted } from "@/lib/account-restriction";
import { assertNotInMaintenance } from "@/lib/maintenance.functions";




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
    entry_phrase?: string | null;
  }) =>
    z.object({
      event_id: z.string().uuid(),
      guest_count: z.number().int().min(1).max(10).default(1),
      age_confirmed: z.literal(true, {
        error: "You must confirm you are 18+.",
      }),
      video_consent: videoConsentSchema,
      waiver_accepted: z.literal(true, {
        error: "You must accept the liability waiver to RSVP.",
      }),
      waiver_signature: z.string().trim().min(2, "Type your full legal name to sign.").max(120),
      waiver_text_hash: z.string().regex(/^[a-f0-9]{64}$/, "Waiver signature is invalid — please refresh."),
      // Server-side mirror of the DB trigger: trim, and treat empty /
      // whitespace-only as null so the trigger picks a phrase.
      entry_phrase: z
        .union([z.string(), z.null()])
        .optional()
        .transform((v) => normalizeEntryPhrase(v ?? null))
        .refine((v) => v === null || v.length <= 120, {
          message: "Entry phrase must be 120 characters or fewer.",
        }),
    }).parse(data),
  )

  .handler(async ({ data, context }) => {
    // Block bookings for accounts that admins have restricted from the CRM.
    await assertAccountNotRestricted(context.supabase, context.userId);

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

    // Require a currently-valid, admin-approved health screening on file.
    // "Admin review" (status = 'pending') and expired/rejected screenings all block booking.
    const today = new Date().toISOString().slice(0, 10);
    const { data: screenings } = await context.supabase
      .from("health_screenings")
      .select("status, valid_until")
      .eq("user_id", context.userId)
      .order("submitted_at", { ascending: false });
    const list = screenings ?? [];
    const hasCurrent = list.some(
      (s) => s.status === "approved" && s.valid_until !== null && s.valid_until >= today,
    );
    if (!hasCurrent) {
      const latest = list[0];
      if (!latest) {
        throw new Error(
          "Please upload a current health screening — one is required before you can finalize an RSVP.",
        );
      }
      if (latest.status === "pending") {
        throw new Error(
          "Your health screening is awaiting admin review. You'll be able to RSVP once it's approved.",
        );
      }
      if (latest.status === "rejected") {
        throw new Error(
          "Your most recent health screening was not accepted. Please upload a current document.",
        );
      }
      throw new Error(
        "Your health screening has expired. Please upload a new document (test taken within the last 90 days).",
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

    // Detect whether this is a first-time acceptance or a re-signing.
    const { data: prior } = await context.supabase
      .from("rsvps")
      .select("id, waiver_accepted_at, waiver_text_hash")
      .eq("event_id", data.event_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    const now = new Date().toISOString();
    // `data.entry_phrase` is already normalized by the input validator:
    // null when the caller sent blank / whitespace-only. Omit the field
    // entirely in that case so the BEFORE INSERT trigger picks one.
    const basePayload = {
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
    };
    const upsertPayload =
      data.entry_phrase !== null
        ? { ...basePayload, entry_phrase: data.entry_phrase }
        : basePayload;
    const { data: row, error } = await context.supabase
      .from("rsvps")
      .upsert(upsertPayload, { onConflict: "event_id,user_id" })
      .select("id, ticket_code, entry_code, entry_phrase")
      .single();


    if (error) throw error;

    // Record an audit entry for this waiver acceptance
    try {
      const { getRequestHeader } = await import("@tanstack/react-start/server");
      const ua = getRequestHeader("user-agent") ?? null;
      const ip =
        (getRequestHeader("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
        getRequestHeader("cf-connecting-ip") ||
        getRequestHeader("x-real-ip") ||
        null;
      const wasPriorAccepted = Boolean(prior?.waiver_accepted_at);
      await context.supabase.from("waiver_audit_log").insert({
        event_id: data.event_id,
        rsvp_id: row.id,
        user_id: context.userId,
        action: wasPriorAccepted ? "re_accepted" : "accepted",
        waiver_text_hash: currentHash,
        waiver_signature: data.waiver_signature.trim(),
        ip_address: ip,
        user_agent: ua,
      });
    } catch {
      // Auditing is best-effort — never block a valid RSVP if the log write fails.
    }

    // Auto-redeem free event ticket on first RSVP for members whose plan
    // includes one: lifetime (always) or an active 12-month all-access pass
    // (`term_pass_12` with `expires_at > now`). Lifetime wins over term_pass_12
    // if the user somehow holds both.
    const env = process.env.NODE_ENV === "production" ? "live" : "sandbox";
    const { data: perkRows } = await context.supabase
      .from("memberships")
      .select("id, kind, event_ticket_used_at, expires_at")
      .eq("user_id", context.userId)
      .eq("environment", env)
      .in("kind", ["lifetime", "term_pass_12"]);
    const nowMs = Date.now();
    const perkRow =
      (perkRows ?? []).find((r: any) => r.kind === "lifetime") ??
      (perkRows ?? []).find(
        (r: any) =>
          r.kind === "term_pass_12" &&
          r.expires_at &&
          new Date(r.expires_at).getTime() > nowMs,
      );
    if (perkRow && !perkRow.event_ticket_used_at) {
      await context.supabase
        .from("memberships")
        .update({
          event_ticket_used_at: now,
          event_ticket_event_id: data.event_id,
        })
        .eq("id", perkRow.id);
    }
    return {
      ticket_code: row.ticket_code,
      entry_code: row.entry_code,
      entry_phrase: row.entry_phrase,
    };
  });


export const cancelRsvp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string }) =>
    z.object({ event_id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Capture what the guest had signed BEFORE deleting the RSVP,
    // so the audit trail preserves the rescinded waiver hash.
    const { data: prior } = await context.supabase
      .from("rsvps")
      .select("id, waiver_text_hash, waiver_signature, waiver_accepted_at")
      .eq("event_id", data.event_id)
      .eq("user_id", context.userId)
      .maybeSingle();

    const { error } = await context.supabase
      .from("rsvps")
      .delete()
      .eq("event_id", data.event_id)
      .eq("user_id", context.userId);
    if (error) throw error;

    if (prior?.waiver_accepted_at) {
      try {
        const { getRequestHeader } = await import("@tanstack/react-start/server");
        const ua = getRequestHeader("user-agent") ?? null;
        const ip =
          (getRequestHeader("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
          getRequestHeader("cf-connecting-ip") ||
          getRequestHeader("x-real-ip") ||
          null;
        await context.supabase.from("waiver_audit_log").insert({
          event_id: data.event_id,
          rsvp_id: null,
          user_id: context.userId,
          action: "rescinded",
          waiver_text_hash: prior.waiver_text_hash,
          waiver_signature: prior.waiver_signature,
          ip_address: ip,
          user_agent: ua,
        });
      } catch {
        // best-effort
      }
    }
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
      .select("id, ticket_code, entry_code, entry_phrase, guest_count, status, video_consent, age_confirmed_at, consent_confirmed_at, waiver_signature, waiver_accepted_at")
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
      .select("id, ticket_code, entry_code, entry_phrase, guest_count, status, created_at, events(id, title, starts_at, venue_name, city, cover_image_url)")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });
