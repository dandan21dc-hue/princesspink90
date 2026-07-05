import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const env = () => (process.env.NODE_ENV === "production" ? "live" : "sandbox");

export const getMyMembership = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data } = await supabase
      .from("memberships")
      .select("*")
      .eq("user_id", userId)
      .eq("environment", env())
      .eq("kind", "lifetime")
      .maybeSingle();
    return { membership: data ?? null };
  });

export const requestPrivateSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
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
    const { data: m } = await supabase
      .from("memberships")
      .select("id, event_ticket_used_at")
      .eq("user_id", userId)
      .eq("environment", env())
      .eq("kind", "lifetime")
      .maybeSingle();
    if (!m) throw new Error("No lifetime membership on file");
    if (m.event_ticket_used_at) throw new Error("Free event ticket already used");

    const { error } = await supabase
      .from("memberships")
      .update({
        event_ticket_used_at: new Date().toISOString(),
        event_ticket_event_id: data.eventId,
      })
      .eq("id", m.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
