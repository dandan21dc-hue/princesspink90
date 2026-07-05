import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const env = () => (process.env.NODE_ENV === "production" ? "live" : "sandbox");

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const amIAdmin = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    return { isAdmin: Boolean(data) };
  });

export const listLifetimeMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: memberships, error } = await supabaseAdmin
      .from("memberships")
      .select("*, events:event_ticket_event_id(id, title, starts_at)")
      .eq("kind", "lifetime")
      .eq("environment", env())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((memberships ?? []).map((m) => m.user_id)));
    if (userIds.length === 0) return { members: [] };

    const [{ data: profiles }, { data: purchases }] = await Promise.all([
      supabaseAdmin.from("profiles").select("user_id, display_name").in("user_id", userIds),
      supabaseAdmin
        .from("content_purchases")
        .select("user_id, content_item_id, created_at, content_items(id, title, kind)")
        .in("user_id", userIds)
        .eq("environment", env()),
    ]);

    const emails: Record<string, string | null> = {};
    for (const uid of userIds) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
      emails[uid] = u.user?.email ?? null;
    }

    const profileMap = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));
    const purchasesByUser = new Map<string, any[]>();
    for (const p of purchases ?? []) {
      const arr = purchasesByUser.get(p.user_id) ?? [];
      arr.push(p);
      purchasesByUser.set(p.user_id, arr);
    }

    const members = (memberships ?? []).map((m) => ({
      id: m.id,
      user_id: m.user_id,
      display_name: profileMap.get(m.user_id) ?? null,
      email: emails[m.user_id] ?? null,
      purchased_at: m.created_at,
      amount_cents: m.amount_cents,
      event_ticket_used_at: m.event_ticket_used_at,
      event_ticket_event: m.events ?? null,
      private_session_requested_at: m.private_session_requested_at,
      private_session_fulfilled_at: m.private_session_fulfilled_at,
      one_time_purchases: purchasesByUser.get(m.user_id) ?? [],
    }));

    return { members };
  });
