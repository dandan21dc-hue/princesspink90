import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { videoConsentSchema, type VideoConsent } from "@/lib/verification.functions";
import { normalizeEntryPhrase } from "@/lib/entry-phrase";

/**
 * Standard shape every PostgREST builder resolves to when awaited.
 * Every DB call in this file destructures into `{ data, error }` and
 * routes error handling through `unwrap()` so behaviour is uniform.
 */
export type PostgrestResult<T> = { data: T | null; error: { message?: string } | null };

/** Throw on a PostgREST error, otherwise return the data (possibly `null`). */
function unwrap<T>(result: PostgrestResult<T>, label: string): T | null {
  if (result.error) {
    const msg = result.error.message ?? "unknown error";
    throw new Error(`${label}: ${msg}`);
  }
  return result.data;
}

/** Same as `unwrap` but throws when the row is missing. */
function unwrapRequired<T>(result: PostgrestResult<T>, label: string): T {
  const data = unwrap(result, label);
  if (data == null) throw new Error(`${label}: not found`);
  return data;
}

async function assertEventHostOrAdmin(
  supabase: any,
  userId: string,
  eventId: string,
) {
  const ev = unwrap<{ host_id: string }>(
    (await supabase
      .from("events")
      .select("host_id")
      .eq("id", eventId)
      .maybeSingle()) as PostgrestResult<{ host_id: string }>,
    "load event",
  );
  if (!ev) throw new Error("Event not found.");
  if (ev.host_id === userId) return;
  const isAdmin = unwrap<boolean>(
    (await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    })) as PostgrestResult<boolean>,
    "check admin role",
  );
  if (!isAdmin) throw new Error("Only the event host can run door check-in.");
}

export const CHECKIN_RSVP_COLUMNS =
  "id, user_id, ticket_code, entry_code, entry_phrase, guest_count, status, video_consent, checked_in_at, door_notes";

/**
 * Escape user-supplied text before it is passed to a PostgREST `ilike`
 * filter. PostgREST treats `%` and `_` as wildcards and `\` as the
 * escape char, so unescaped input lets a caller match every row
 * (`%`) or bypass intended narrowing. Exported for unit tests that
 * assert the exact escape behaviour used by lookupCheckin.
 */
export function escapePostgrestLikePattern(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

/**
 * Internal handler for `lookupCheckin`. Extracted from the server-fn
 * wrapper so unit tests can drive it with a mocked Supabase client and
 * assert that user input flows through parameterised `.eq()` / `.ilike()`
 * builder methods — never interpolated into a raw `.or()` filter string.
 */
export async function lookupCheckinQuery(
  supabase: any,
  input: { event_id: string; ticket_code: string },
): Promise<{ rsvp: any | null }> {
  const raw = input.ticket_code.trim();
  const upper = raw.toUpperCase();
  // Only search entry_phrase when the input is a non-blank string —
  // matches the DB trigger's normalization so ' ' or '' can't match
  // rows whose phrase happens to contain a space.
  const phraseSearch = normalizeEntryPhrase(raw);

  // Accept the scan-code (ticket_code), the entry_code, OR the secret entry
  // phrase (case-insensitive) so the door monitor can look a guest up by
  // whichever value the guest offers. Run three parameterised queries
  // instead of a raw .or() string so user input can never inject
  // PostgREST filter syntax (commas, wildcards, extra clauses).
  const base = () =>
    supabase
      .from("rsvps")
      .select(CHECKIN_RSVP_COLUMNS)
      .eq("event_id", input.event_id);

  const queries: Array<Promise<PostgrestResult<any>>> = [
    Promise.resolve(base().eq("ticket_code", upper).maybeSingle()),
    Promise.resolve(base().eq("entry_code", upper).maybeSingle()),
  ];
  if (phraseSearch) {
    queries.push(
      Promise.resolve(
        base()
          .ilike("entry_phrase", escapePostgrestLikePattern(phraseSearch))
          .maybeSingle(),
      ),
    );
  }

  const results = await Promise.all(queries);
  const rsvp =
    results
      .map((r, i) =>
        unwrap<any>(r, `lookup checkin (query ${i + 1})`),
      )
      .find((r) => r) ?? null;
  return { rsvp };
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
    const { rsvp } = await lookupCheckinQuery(context.supabase, data);
    if (!rsvp) return { found: false as const };

    // Load profile + age verification via admin-scoped queries (host can't
    // read other users' profiles/verifications directly).
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const [profRes, avRes, authUserRes] = await Promise.all([
      supabaseAdmin
        .from("profiles")
        .select("display_name")
        .eq("user_id", rsvp.user_id)
        .maybeSingle() as unknown as Promise<PostgrestResult<{ display_name: string | null }>>,
      supabaseAdmin
        .from("age_verifications")
        .select("status, date_of_birth, reviewed_at")
        .eq("user_id", rsvp.user_id)
        .maybeSingle() as unknown as Promise<
          PostgrestResult<{ status: string; date_of_birth: string; reviewed_at: string | null }>
        >,
      supabaseAdmin.auth.admin.getUserById(rsvp.user_id),
    ]);


    const prof = unwrap(profRes, "load guest profile");
    const av = unwrap(avRes, "load age verification");

    return {
      found: true as const,
      rsvp,
      guest: {
        display_name: prof?.display_name ?? null,
        email: authUserRes?.data?.user?.email ?? null,
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
    const rsvp = unwrapRequired<{ user_id: string; event_id: string }>(
      (await context.supabase
        .from("rsvps")
        .select("user_id, event_id")
        .eq("id", data.rsvp_id)
        .maybeSingle()) as PostgrestResult<{ user_id: string; event_id: string }>,
      "load RSVP",
    );
    if (rsvp.event_id !== data.event_id) throw new Error("RSVP not found.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const av = unwrap<{ status: string }>(
      (await supabaseAdmin
        .from("age_verifications")
        .select("status")
        .eq("user_id", rsvp.user_id)
        .maybeSingle()) as PostgrestResult<{ status: string }>,
      "load age verification",
    );
    if (!av || av.status !== "approved") {
      throw new Error("Guest is not age-verified — do not admit.");
    }

    unwrap(
      (await context.supabase
        .from("rsvps")
        .update({
          checked_in_at: new Date().toISOString(),
          checked_in_by: context.userId,
          video_consent: data.consent,
          consent_at_checkin: data.consent,
          door_notes: data.door_notes ?? null,
        })
        .eq("id", data.rsvp_id)) as PostgrestResult<null>,
      "update RSVP check-in",
    );
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

    const rows =
      unwrap<any[]>(
        (await context.supabase
          .from("rsvps")
          .select(
            "id, user_id, ticket_code, entry_code, entry_phrase, guest_count, checked_in_at, consent_at_checkin, video_consent, door_notes",
          )
          .eq("event_id", data.event_id)
          .not("checked_in_at", "is", null)
          .order("checked_in_at", { ascending: false })) as PostgrestResult<any[]>,
        "list check-ins",
      ) ?? [];

    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    let nameByUser = new Map<string, string | null>();
    if (userIds.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const profs =
        unwrap<Array<{ user_id: string; display_name: string | null }>>(
          (await supabaseAdmin
            .from("profiles")
            .select("user_id, display_name")
            .in("user_id", userIds)) as PostgrestResult<
              Array<{ user_id: string; display_name: string | null }>
            >,
          "load guest profiles",
        ) ?? [];
      nameByUser = new Map(profs.map((p) => [p.user_id, p.display_name]));
    }

    const guests = rows.map((r) => ({
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

    const event = unwrapRequired<{
      id: string;
      title: string;
      starts_at: string;
      venue_name: string | null;
      address: string | null;
      city: string | null;
      dress_code: string | null;
    }>(
      (await context.supabase
        .from("events")
        .select("id, title, starts_at, venue_name, address, city, dress_code")
        .eq("id", data.event_id)
        .maybeSingle()) as PostgrestResult<any>,
      "load event",
    );

    const rows =
      unwrap<any[]>(
        (await context.supabase
          .from("rsvps")
          .select(
            "id, user_id, ticket_code, entry_code, entry_phrase, guest_count, status, video_consent, checked_in_at",
          )
          .eq("event_id", data.event_id)
          .eq("status", "confirmed")
          .order("entry_code", { ascending: true })) as PostgrestResult<any[]>,
        "list confirmed RSVPs",
      ) ?? [];

    const userIds = Array.from(new Set(rows.map((r) => r.user_id)));
    let nameByUser = new Map<string, string | null>();
    let ageByUser = new Map<string, string | null>();
    if (userIds.length) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const [profsRes, avsRes] = await Promise.all([
        supabaseAdmin
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds) as unknown as Promise<
            PostgrestResult<Array<{ user_id: string; display_name: string | null }>>
          >,
        supabaseAdmin
          .from("age_verifications")
          .select("user_id, status")
          .in("user_id", userIds) as unknown as Promise<
            PostgrestResult<Array<{ user_id: string; status: string }>>
          >,
      ]);
      const profs = unwrap(profsRes, "load guest profiles") ?? [];
      const avs = unwrap(avsRes, "load age verifications") ?? [];
      nameByUser = new Map(profs.map((p) => [p.user_id, p.display_name]));
      ageByUser = new Map(avs.map((a) => [a.user_id, a.status]));
    }

    const guests = rows.map((r) => ({
      id: r.id,
      ticket_code: r.ticket_code,
      entry_code: r.entry_code,
      entry_phrase: r.entry_phrase,
      guest_count: r.guest_count,
      display_name: nameByUser.get(r.user_id) ?? null,
      age_status: ageByUser.get(r.user_id) ?? "missing",
      consent: (r.video_consent ?? null) as VideoConsent | null,
      already_checked_in: !!r.checked_in_at,
    }));

    const total_heads = guests.reduce((s, g) => s + (g.guest_count ?? 1), 0);
    return { event, guests, total_heads };
  });
