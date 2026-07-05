import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const env = () => (process.env.NODE_ENV === "production" ? "live" : "sandbox");

/**
 * Which membership kinds unlock the "1 free event ticket" perk.
 *
 *  - `lifetime`         → always eligible.
 *  - `term_pass_12`     → eligible while the pass is active (`expires_at > now()`).
 *
 * `term_pass_3` / `term_pass_6` do NOT include a free ticket per the
 * store copy on /store/subscribe.
 */
const TICKET_ELIGIBLE_KINDS = ["lifetime", "term_pass_12"] as const;
type TicketEligibleKind = (typeof TICKET_ELIGIBLE_KINDS)[number];

/**
 * Resolve the membership row that owns the perks. Lifetime wins over an
 * active 12-month pass so a member holding both doesn't spend their
 * lifetime ticket on a term-pass RSVP.
 */
async function loadPerkMembership(
  supabase: any,
  userId: string,
): Promise<{
  id: string;
  kind: TicketEligibleKind;
  event_ticket_used_at: string | null;
  event_ticket_event_id: string | null;
  expires_at: string | null;
  private_session_requested_at: string | null;
  private_session_fulfilled_at: string | null;
  private_session_duration_minutes: number;
  private_session_bundle_id: string | null;
  private_session_bundle_granted_at: string | null;
} | null> {
  const { data: rows } = await supabase
    .from("memberships")
    .select(
      "id, kind, event_ticket_used_at, event_ticket_event_id, expires_at, private_session_requested_at, private_session_fulfilled_at, private_session_duration_minutes, private_session_bundle_id, private_session_bundle_granted_at",
    )
    .eq("user_id", userId)
    .eq("environment", env())
    .in("kind", TICKET_ELIGIBLE_KINDS as unknown as string[]);

  if (!rows?.length) return null;
  const now = Date.now();
  const lifetime = rows.find((r: any) => r.kind === "lifetime");
  if (lifetime) return lifetime;
  const term12 = rows.find(
    (r: any) =>
      r.kind === "term_pass_12" && r.expires_at && new Date(r.expires_at).getTime() > now,
  );
  return term12 ?? null;
}

export const getMyMembership = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const membership = await loadPerkMembership(supabase, userId);
    return { membership };
  });

export const requestPrivateSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    // Private session is a LIFETIME-only perk — do not widen this.
    const { data: m } = await supabase
      .from("memberships")
      .select("id, private_session_requested_at")
      .eq("user_id", userId)
      .eq("environment", env())
      .eq("kind", "lifetime")
      .maybeSingle();
    if (!m) throw new Error("No lifetime membership on file");
    if (m.private_session_requested_at) {
      return { ok: true, alreadyRequested: true };
    }
    const { error } = await supabase
      .from("memberships")
      .update({ private_session_requested_at: new Date().toISOString() })
      .eq("id", m.id);
    if (error) throw new Error(error.message);

    // Notify all creators of the request
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: creators } = await supabaseAdmin
      .from("content_items")
      .select("creator_id");
    const ids = Array.from(new Set((creators ?? []).map((c) => c.creator_id).filter(Boolean)));
    if (ids.length) {
      await supabaseAdmin.from("notifications").insert(
        ids.map((cid) => ({
          user_id: cid as string,
          kind: "private_session_request",
          title: "Private session requested 🔥",
          body: "A lifetime member is redeeming their private session perk.",
          link_url: "/dashboard",
          metadata: { member_user_id: userId } as any,
        })),
      );
    }
    return { ok: true, alreadyRequested: false };
  });

export const redeemEventTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { eventId: string }) => {
    if (!/^[a-f0-9-]+$/i.test(data.eventId)) throw new Error("Invalid event id");
    return data;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const m = await loadPerkMembership(supabase, userId);
    if (!m) throw new Error("No membership with a free ticket perk on file");
    if (m.event_ticket_used_at) throw new Error("Free event ticket already used");

    const { error } = await supabase
      .from("memberships")
      .update({
        event_ticket_used_at: new Date().toISOString(),
        event_ticket_event_id: data.eventId,
      })
      .eq("id", m.id);
    if (error) throw new Error(error.message);
    return { ok: true, redeemedFrom: m.kind };
  });
