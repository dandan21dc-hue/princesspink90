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

export const getMyRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    const roles = (data ?? []).map((r: { role: string }) => r.role);
    return {
      roles,
      isAdmin: roles.includes("admin"),
      isCoHost: roles.includes("co_host"),
      canAccessDashboard: roles.includes("admin") || roles.includes("co_host"),
    };
  });

// ---------- User management (roles) ----------

export const listAllUsersWithRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const users: Array<{
      id: string;
      email: string | null;
      created_at: string | null;
      display_name: string | null;
      roles: string[];
    }> = [];

    // Page through auth users
    let page = 1;
    const perPage = 200;
    // Cap at 20 pages (~4000 users) to keep this safe.
    for (let i = 0; i < 20; i++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        users.push({
          id: u.id,
          email: u.email ?? null,
          created_at: u.created_at ?? null,
          display_name: null,
          roles: [],
        });
      }
      if (data.users.length < perPage) break;
      page += 1;
    }

    if (users.length === 0) return { users };

    const ids = users.map((u) => u.id);
    const [{ data: profiles }, { data: roleRows }] = await Promise.all([
      supabaseAdmin.from("profiles").select("user_id, display_name").in("user_id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);

    const nameMap = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));
    const rolesByUser = new Map<string, string[]>();
    for (const r of roleRows ?? []) {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as string);
      rolesByUser.set(r.user_id, arr);
    }

    for (const u of users) {
      u.display_name = nameMap.get(u.id) ?? null;
      u.roles = rolesByUser.get(u.id) ?? [];
    }

    users.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    return { users };
  });

export const setUserCoHostRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; role: "user" | "co_host" }) => {
    if (!data.userId) throw new Error("userId required");
    if (data.role !== "user" && data.role !== "co_host") {
      throw new Error("role must be 'user' or 'co_host'");
    }
    return data;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Never let this endpoint touch the 'admin' role — admins are managed by migration.
    if (data.role === "co_host") {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .upsert(
          { user_id: data.userId, role: "co_host" as const },
          { onConflict: "user_id,role" },
        );
      if (error) throw new Error(error.message);
    } else {
      // "user" — clear the co_host grant. Leave admin intact.
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", "co_host");
      if (error) throw new Error(error.message);
    }
    return { ok: true as const };
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

const REQUIRED_EVENT_DOCS = ["permit", "insurance", "capacity"] as const;

export const adminListEventsCompliance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: events, error } = await supabaseAdmin
      .from("events")
      .select(
        "id, title, starts_at, published, is_private, host_id, venue_name, city, capacity, legal_capacity, permits_confirmed, insurance_confirmed, capacity_confirmed, insurance_provider, insurance_expires_on, permit_details, compliance_notes",
      )
      .order("starts_at", { ascending: false });
    if (error) throw new Error(error.message);

    const eventIds = (events ?? []).map((e) => e.id);
    const hostIds = Array.from(new Set((events ?? []).map((e) => e.host_id).filter(Boolean)));

    const [{ data: docs }, { data: profiles }] = await Promise.all([
      eventIds.length
        ? supabaseAdmin
            .from("event_documents")
            .select("id, event_id, doc_type, file_name, uploaded_at")
            .in("event_id", eventIds)
        : Promise.resolve({ data: [] as any[] }),
      hostIds.length
        ? supabaseAdmin.from("profiles").select("user_id, display_name").in("user_id", hostIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const docsByEvent = new Map<string, any[]>();
    for (const d of docs ?? []) {
      const arr = docsByEvent.get(d.event_id) ?? [];
      arr.push(d);
      docsByEvent.set(d.event_id, arr);
    }
    const nameByHost = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));

    const now = Date.now();
    const soonMs = 30 * 24 * 60 * 60 * 1000;

    const rows = (events ?? []).map((e) => {
      const eventDocs = docsByEvent.get(e.id) ?? [];
      const typesOnFile = new Set(eventDocs.map((d) => d.doc_type as string));
      const missing = REQUIRED_EVENT_DOCS.filter((t) => !typesOnFile.has(t));
      const confirmations = {
        permits: !!e.permits_confirmed,
        insurance: !!e.insurance_confirmed,
        capacity: !!e.capacity_confirmed,
      };
      const missingConfirmations = Object.entries(confirmations)
        .filter(([, v]) => !v)
        .map(([k]) => k);
      const insuranceExpiry = e.insurance_expires_on ? new Date(e.insurance_expires_on).getTime() : null;
      const insuranceStatus: "ok" | "expiring" | "expired" | "unknown" =
        insuranceExpiry == null
          ? "unknown"
          : insuranceExpiry < now
            ? "expired"
            : insuranceExpiry - now < soonMs
              ? "expiring"
              : "ok";
      const capacityOverLimit =
        e.capacity != null && e.legal_capacity != null && e.capacity > e.legal_capacity;

      let status: "approved" | "pending" | "flagged";
      const flagged =
        missing.length > 0 ||
        missingConfirmations.length > 0 ||
        insuranceStatus === "expired" ||
        capacityOverLimit;
      if (e.published && !flagged) status = "approved";
      else if (flagged) status = "flagged";
      else status = "pending";

      return {
        id: e.id,
        title: e.title,
        starts_at: e.starts_at,
        published: !!e.published,
        is_private: !!e.is_private,
        venue_name: e.venue_name,
        city: e.city,
        host_id: e.host_id,
        host_name: nameByHost.get(e.host_id) ?? null,
        capacity: e.capacity,
        legal_capacity: e.legal_capacity,
        confirmations,
        missing_confirmations: missingConfirmations,
        missing_docs: missing,
        docs_on_file: eventDocs.map((d) => ({
          id: d.id, doc_type: d.doc_type, file_name: d.file_name, uploaded_at: d.uploaded_at,
        })),
        insurance_provider: e.insurance_provider,
        insurance_expires_on: e.insurance_expires_on,
        insurance_status: insuranceStatus,
        capacity_over_limit: capacityOverLimit,
        status,
      };
    });

    const summary = {
      total: rows.length,
      approved: rows.filter((r) => r.status === "approved").length,
      pending: rows.filter((r) => r.status === "pending").length,
      flagged: rows.filter((r) => r.status === "flagged").length,
      published: rows.filter((r) => r.published).length,
    };

    return { rows, summary };
  });

// (Stripe subscription resync removed — NOWPayments is the only payment provider.)


// ---------- Free event-entry perk (12-month term + lifetime members) ----------

export const listFreeEntryPerkMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: memberships, error } = await supabaseAdmin
      .from("memberships")
      .select("id, user_id, kind, created_at, expires_at, event_ticket_used_at, event_ticket_event_id, events:event_ticket_event_id(id, title, starts_at)")
      .in("kind", ["lifetime", "term_pass_12"])
      .eq("environment", env())
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((memberships ?? []).map((m) => m.user_id)));
    if (userIds.length === 0) return { members: [] };

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name")
      .in("user_id", userIds);

    const emails: Record<string, string | null> = {};
    for (const uid of userIds) {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
      emails[uid] = u.user?.email ?? null;
    }
    const nameMap = new Map((profiles ?? []).map((p) => [p.user_id, p.display_name]));

    const members = (memberships ?? []).map((m) => ({
      id: m.id,
      user_id: m.user_id,
      display_name: nameMap.get(m.user_id) ?? null,
      email: emails[m.user_id] ?? null,
      kind: m.kind as "lifetime" | "term_pass_12",
      purchased_at: m.created_at,
      expires_at: m.expires_at,
      redeemed: Boolean(m.event_ticket_used_at),
      redeemed_at: m.event_ticket_used_at,
      redeemed_event: m.events ?? null,
    }));

    const totals = {
      total: members.length,
      redeemed: members.filter((m) => m.redeemed).length,
      unused: members.filter((m) => !m.redeemed).length,
    };
    return { members, totals };
  });

