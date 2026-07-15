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


// ---------- Manual All-Access grant / revoke (admin testing) ----------

type AllAccessGrantKind = "term_pass_all_access_30d" | "lifetime";

const ALL_ACCESS_KINDS = [
  "term_pass_all_access_30d",
  "term_pass_3",
  "term_pass_6",
  "term_pass_12",
  "lifetime",
] as const;

async function findUserByEmailAdmin(supabaseAdmin: any, email: string) {
  const target = email.trim().toLowerCase();
  if (!target) throw new Error("email required");
  let page = 1;
  const perPage = 200;
  for (let i = 0; i < 20; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(error.message);
    const match = data.users.find((u: any) => (u.email ?? "").toLowerCase() === target);
    if (match) return { id: match.id as string, email: match.email as string | null };
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

export const adminLookupUserAllAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string }) => {
    if (!d?.email) throw new Error("email required");
    return { email: d.email };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const user = await findUserByEmailAdmin(supabaseAdmin, data.email);
    if (!user) return { user: null, memberships: [] as any[] };

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: memberships, error } = await supabaseAdmin
      .from("memberships")
      .select("id, kind, environment, expires_at, created_at, amount_cents, external_payment_reference")
      .eq("user_id", user.id)
      .in("kind", ALL_ACCESS_KINDS as unknown as string[])
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    return {
      user: { id: user.id, email: user.email, display_name: profile?.display_name ?? null },
      memberships: memberships ?? [],
    };
  });

export const adminGrantAllAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; kind: AllAccessGrantKind }) => {
    if (!d?.userId) throw new Error("userId required");
    if (d.kind !== "term_pass_all_access_30d" && d.kind !== "lifetime") {
      throw new Error("kind must be term_pass_all_access_30d or lifetime");
    }
    return d;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const environment = env();
    const externalRef = `admin_manual:${context.userId}:${Date.now()}`;
    const rpc =
      data.kind === "lifetime" ? "grant_lifetime_membership" : "grant_all_access_pass_30d";

    const { data: row, error } = await supabaseAdmin.rpc(rpc, {
      _user_id: data.userId,
      _environment: environment,
      _amount_cents: 0,
      _external_payment_reference: externalRef,
    });
    if (error) throw new Error(error.message);

    // Record the grant in the admin audit chain (RLS: actor_id = auth.uid()).
    await context.supabase.from("admin_activity_audit").insert({
      actor_id: context.userId,
      action: "grant_all_access",
      resource: `user:${data.userId}`,
      metadata: {
        target_user_id: data.userId,
        kind: data.kind,
        rpc,
        environment,
        membership_id: (row as { id?: string } | null)?.id ?? null,
        external_payment_reference: externalRef,
      },
    });

    return { membership: row };
  });

export const adminRevokeAllAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { membershipId: string }) => {
    if (!d?.membershipId) throw new Error("membershipId required");
    return d;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Snapshot the row first so the audit entry records what was revoked
    // even though the row itself is about to be deleted.
    const { data: existing } = await supabaseAdmin
      .from("memberships")
      .select("id, user_id, kind, environment, expires_at, external_payment_reference")
      .eq("id", data.membershipId)
      .in("kind", ALL_ACCESS_KINDS as unknown as string[])
      .maybeSingle();

    const { error } = await supabaseAdmin
      .from("memberships")
      .delete()
      .eq("id", data.membershipId)
      .in("kind", ALL_ACCESS_KINDS as unknown as string[]);
    if (error) throw new Error(error.message);

    if (existing) {
      await context.supabase.from("admin_activity_audit").insert({
        actor_id: context.userId,
        action: "revoke_all_access",
        resource: `user:${existing.user_id}`,
        metadata: {
          target_user_id: existing.user_id,
          kind: existing.kind,
          rpc: "delete_membership",
          environment: existing.environment,
          membership_id: existing.id,
          expires_at: existing.expires_at,
          external_payment_reference: existing.external_payment_reference,
        },
      });
    }

    return { ok: true };
  });

/**
 * Recent grant/revoke history for the manual All-Access admin page.
 * Reads from the append-only hash-chained admin_activity_audit table.
 * Optionally filter by target user (as recorded in metadata.target_user_id).
 */
export const adminListAllAccessAudit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId?: string; limit?: number } = {}) => ({
    userId: d.userId,
    limit: Math.min(Math.max(d.limit ?? 25, 1), 100),
  }))
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let query = supabaseAdmin
      .from("admin_activity_audit")
      .select("id, actor_id, action, resource, metadata, created_at")
      .in("action", ["grant_all_access", "revoke_all_access"])
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.userId) {
      query = query.eq("resource", `user:${data.userId}`);
    }

    const { data: rows, error } = await query;
    if (error) throw new Error(error.message);

    // Enrich with actor email/display name for the UI.
    const actorIds = Array.from(new Set((rows ?? []).map((r) => r.actor_id).filter(Boolean)));
    const actorMap = new Map<string, { email: string | null; display_name: string | null }>();
    if (actorIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", actorIds);
      for (const p of profiles ?? []) {
        actorMap.set(p.user_id as string, { email: null, display_name: p.display_name ?? null });
      }
      for (const id of actorIds) {
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
          const email = u?.user?.email ?? null;
          const existing = actorMap.get(id) ?? { email: null, display_name: null };
          actorMap.set(id, { ...existing, email });
        } catch {
          // best-effort enrichment
        }
      }
    }

    return {
      entries: (rows ?? []).map((r) => ({
        id: r.id as string,
        action: r.action as "grant_all_access" | "revoke_all_access",
        resource: r.resource as string,
        created_at: r.created_at as string,
        actor_id: r.actor_id as string,
        actor: actorMap.get(r.actor_id as string) ?? { email: null, display_name: null },
        metadata: (r.metadata ?? {}) as {
          target_user_id?: string;
          kind?: string;
          rpc?: string;
          environment?: string;
          membership_id?: string | null;
          expires_at?: string | null;
          external_payment_reference?: string | null;
        },

      })),
    };
  });

