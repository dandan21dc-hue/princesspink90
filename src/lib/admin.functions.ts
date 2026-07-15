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

    // Post-delete verification: re-read by id to confirm the row is gone.
    const { data: stillThere, error: verifyErr } = await supabaseAdmin
      .from("memberships")
      .select("id")
      .eq("id", data.membershipId)
      .maybeSingle();
    if (verifyErr) throw new Error(`Verification read failed: ${verifyErr.message}`);
    const verified = !stillThere;

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
          verified,
        },
      });
    }

    if (!verified) {
      throw new Error(
        `Delete reported success but membership ${data.membershipId} still exists. Aborting.`,
      );
    }

    return {
      ok: true,
      verified,
      deleted: existing
        ? {
            id: existing.id,
            kind: existing.kind,
            user_id: existing.user_id,
            environment: existing.environment,
            expires_at: existing.expires_at,
          }
        : null,
    };
  });


// ---------- Bulk grant / revoke by CSV of emails ----------

type BulkOp = {
  email: string;
  action: "grant" | "revoke";
  kind?: AllAccessGrantKind;
};

export const adminBulkAllAccess = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { operations: BulkOp[] }) => {
    if (!Array.isArray(d?.operations) || d.operations.length === 0) {
      throw new Error("operations required");
    }
    if (d.operations.length > 500) throw new Error("Maximum 500 rows per batch");
    for (const op of d.operations) {
      if (!op.email) throw new Error("each row requires an email");
      if (op.action !== "grant" && op.action !== "revoke") {
        throw new Error(`invalid action for ${op.email}: ${op.action}`);
      }
      if (op.action === "grant") {
        if (op.kind !== "term_pass_all_access_30d" && op.kind !== "lifetime") {
          throw new Error(`grant kind must be term_pass_all_access_30d or lifetime (${op.email})`);
        }
      }
    }
    return d;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const environment = env();

    // Build a single email → user map from a paged listUsers scan (avoids per-row scans).
    const wantEmails = new Set(
      data.operations.map((o) => o.email.trim().toLowerCase()).filter(Boolean),
    );
    const emailToId = new Map<string, string>();
    let page = 1;
    const perPage = 200;
    for (let i = 0; i < 20 && emailToId.size < wantEmails.size; i++) {
      const { data: pageData, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      for (const u of pageData.users) {
        const em = (u.email ?? "").toLowerCase();
        if (em && wantEmails.has(em)) emailToId.set(em, u.id as string);
      }
      if (pageData.users.length < perPage) break;
      page += 1;
    }

    type Result = {
      email: string;
      action: "grant" | "revoke";
      kind?: string;
      status: "success" | "error";
      message: string;
      membership_id?: string | null;
      revoked_count?: number;
    };
    const results: Result[] = [];

    for (const op of data.operations) {
      const email = op.email.trim().toLowerCase();
      const userId = emailToId.get(email);
      if (!userId) {
        results.push({
          email: op.email,
          action: op.action,
          kind: op.kind,
          status: "error",
          message: "User not found",
        });
        continue;
      }

      try {
        if (op.action === "grant") {
          const rpc =
            op.kind === "lifetime" ? "grant_lifetime_membership" : "grant_all_access_pass_30d";
          const externalRef = `admin_bulk:${context.userId}:${Date.now()}:${email}`;
          const { data: row, error } = await supabaseAdmin.rpc(rpc, {
            _user_id: userId,
            _environment: environment,
            _amount_cents: 0,
            _external_payment_reference: externalRef,
          });
          if (error) throw new Error(error.message);
          const membershipId = (row as { id?: string } | null)?.id ?? null;

          await context.supabase.from("admin_activity_audit").insert({
            actor_id: context.userId,
            action: "grant_all_access",
            resource: `user:${userId}`,
            metadata: {
              target_user_id: userId,
              kind: op.kind,
              rpc,
              environment,
              membership_id: membershipId,
              external_payment_reference: externalRef,
              bulk: true,
            },
          });

          results.push({
            email: op.email,
            action: "grant",
            kind: op.kind,
            status: "success",
            message: op.kind === "lifetime" ? "Lifetime granted" : "30-day pass granted",
            membership_id: membershipId,
          });
        } else {
          // Revoke every All-Access membership row this user has in the current env.
          const { data: existing, error: readErr } = await supabaseAdmin
            .from("memberships")
            .select("id, user_id, kind, environment, expires_at, external_payment_reference")
            .eq("user_id", userId)
            .eq("environment", environment)
            .in("kind", ALL_ACCESS_KINDS as unknown as string[]);
          if (readErr) throw new Error(readErr.message);

          if (!existing || existing.length === 0) {
            results.push({
              email: op.email,
              action: "revoke",
              status: "success",
              message: "No memberships to revoke",
              revoked_count: 0,
            });
            continue;
          }

          const ids = existing.map((m) => m.id);
          const { error: delErr } = await supabaseAdmin
            .from("memberships")
            .delete()
            .in("id", ids);
          if (delErr) throw new Error(delErr.message);

          for (const m of existing) {
            await context.supabase.from("admin_activity_audit").insert({
              actor_id: context.userId,
              action: "revoke_all_access",
              resource: `user:${m.user_id}`,
              metadata: {
                target_user_id: m.user_id,
                kind: m.kind,
                rpc: "delete_membership",
                environment: m.environment,
                membership_id: m.id,
                expires_at: m.expires_at,
                external_payment_reference: m.external_payment_reference,
                bulk: true,
              },
            });
          }

          results.push({
            email: op.email,
            action: "revoke",
            status: "success",
            message: `Revoked ${existing.length} membership${existing.length === 1 ? "" : "s"}`,
            revoked_count: existing.length,
          });
        }
      } catch (e) {
        results.push({
          email: op.email,
          action: op.action,
          kind: op.kind,
          status: "error",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }

    const summary = {
      total: results.length,
      success: results.filter((r) => r.status === "success").length,
      errors: results.filter((r) => r.status === "error").length,
    };
    return { results, summary };
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

// ---------- NOWPayments IPN event browser (admin) ----------

// Local parser mirrors src/routes/api/public/payments/nowpayments-webhook.ts.
// Duplicated intentionally to avoid pulling a route module into a server fn.
const NPE_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type NpeParsedOrder =
  | { kind: "aap30d" | "lifetime"; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | { kind: "panty"; pantyListingId: string; userId: string; environment: "sandbox" | "live"; amountCents: number }
  | { kind: "booking"; bookingId: string; userId: string; environment: "sandbox" | "live"; amountCents: number };

function parseOrderId(orderId: string | null | undefined): NpeParsedOrder | null {
  if (!orderId) return null;
  const parts = orderId.split(":");
  const parseEnv = (v: string) => (v === "sandbox" || v === "live" ? (v as "sandbox" | "live") : null);
  const parseAmount = (v: string) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 && Number.isInteger(n) ? n : null;
  };
  if (parts.length === 4) {
    const [kind, userId, envRaw, amountRaw] = parts;
    if (kind !== "aap30d" && kind !== "lifetime") return null;
    if (!NPE_UUID_RE.test(userId)) return null;
    const environment = parseEnv(envRaw);
    if (!environment) return null;
    const amountCents = parseAmount(amountRaw);
    if (amountCents == null) return null;
    return { kind: kind as "aap30d" | "lifetime", userId, environment, amountCents };
  }
  if (parts.length === 5) {
    const [kind, entityId, userId, envRaw, amountRaw] = parts;
    if (kind !== "panty" && kind !== "booking") return null;
    if (!NPE_UUID_RE.test(entityId) || !NPE_UUID_RE.test(userId)) return null;
    const environment = parseEnv(envRaw);
    if (!environment) return null;
    const amountCents = parseAmount(amountRaw);
    if (amountCents == null) return null;
    if (kind === "panty") {
      return { kind: "panty", pantyListingId: entityId, userId, environment, amountCents };
    }
    return { kind: "booking", bookingId: entityId, userId, environment, amountCents };
  }
  return null;
}


const REVERSAL_REVOKE_STATUSES = ["refunded", "refund", "reversed"] as const;
const REVERSAL_SUSPEND_STATUSES = ["chargeback", "disputed", "dispute"] as const;
const REVERSAL_ALL_STATUSES = [
  ...REVERSAL_REVOKE_STATUSES,
  ...REVERSAL_SUSPEND_STATUSES,
] as const;

export const adminListNowpaymentsEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      d: {
        limit?: number;
        status?: string;
        handled?: "all" | "handled" | "unhandled";
        reversal?: "all" | "any" | "revoked" | "suspended";
        search?: string;
      } = {},
    ) => ({
      limit: Math.min(Math.max(d.limit ?? 100, 1), 500),
      status: d.status?.trim() || undefined,
      handled: d.handled ?? "all",
      reversal: d.reversal ?? "all",
      search: d.search?.trim() || undefined,
    }),
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let q = supabaseAdmin
      .from("nowpayments_ipn_events")
      .select(
        "payment_id, last_status, order_id, handled, reason, payload, received_count, first_seen_at, last_seen_at, processed_at",
      )
      .order("last_seen_at", { ascending: false })
      .limit(data.limit);

    if (data.status) q = q.eq("last_status", data.status);
    if (data.handled === "handled") q = q.eq("handled", true);
    if (data.handled === "unhandled") q = q.eq("handled", false);
    if (data.reversal === "any")
      q = q.in("last_status", REVERSAL_ALL_STATUSES as unknown as string[]);
    if (data.reversal === "revoked")
      q = q.in("last_status", REVERSAL_REVOKE_STATUSES as unknown as string[]);
    if (data.reversal === "suspended")
      q = q.in("last_status", REVERSAL_SUSPEND_STATUSES as unknown as string[]);
    if (data.search) {
      // Search on payment_id or order_id (both text columns).
      q = q.or(`payment_id.ilike.%${data.search}%,order_id.ilike.%${data.search}%`);
    }

    const { data: rows, error } = await q;
    if (error) throw new Error(error.message);

    type Row = NonNullable<typeof rows>[number];
    const events = rows ?? [];

    // Bucket lookups per entitlement kind, keyed by external_payment_reference.
    const paymentRefs = events.map((e: Row) => `nowpayments:${e.payment_id}`);
    const userIds = new Set<string>();
    const parsedByPaymentId = new Map<string, ReturnType<typeof parseOrderId>>();

    for (const e of events) {
      const parsed = parseOrderId(e.order_id ?? undefined);
      parsedByPaymentId.set(e.payment_id, parsed);
      if (parsed) userIds.add(parsed.userId);
    }

    const [
      { data: memberships },
      { data: pantyOrders },
      { data: bookings },
    ] = await Promise.all([
      paymentRefs.length
        ? supabaseAdmin
            .from("memberships")
            .select(
              "id, user_id, kind, environment, expires_at, external_payment_reference, revoked_at, suspended_at, revocation_reason",
            )
            .in("external_payment_reference", paymentRefs)
        : Promise.resolve({ data: [] as any[] }),
      paymentRefs.length
        ? supabaseAdmin
            .from("panty_orders")
            .select(
              "id, user_id, panty_listing_id, status, environment, external_payment_reference, updated_at",
            )
            .in("external_payment_reference", paymentRefs)
        : Promise.resolve({ data: [] as any[] }),
      paymentRefs.length
        ? supabaseAdmin
            .from("private_room_bookings")
            .select(
              "id, user_id, status, starts_at, environment, external_payment_reference, updated_at",
            )
            .in("external_payment_reference", paymentRefs)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const membershipByRef = new Map((memberships ?? []).map((m: any) => [m.external_payment_reference, m]));
    const pantyByRef = new Map((pantyOrders ?? []).map((p: any) => [p.external_payment_reference, p]));
    const bookingByRef = new Map((bookings ?? []).map((b: any) => [b.external_payment_reference, b]));

    // Resolve user emails/display names for any users referenced.
    const userMap = new Map<string, { email: string | null; display_name: string | null }>();
    const idArray = Array.from(userIds);
    if (idArray.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", idArray);
      for (const p of profiles ?? []) {
        userMap.set(p.user_id as string, { email: null, display_name: p.display_name ?? null });
      }
      for (const id of idArray) {
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
          const existing = userMap.get(id) ?? { email: null, display_name: null };
          userMap.set(id, { ...existing, email: u?.user?.email ?? null });
        } catch {
          /* best-effort */
        }
      }
    }

    const items = events.map((e: Row) => {
      const parsed = parsedByPaymentId.get(e.payment_id) ?? null;
      const ref = `nowpayments:${e.payment_id}`;
      const membership = membershipByRef.get(ref) ?? null;
      const panty = pantyByRef.get(ref) ?? null;
      const booking = bookingByRef.get(ref) ?? null;

      let entitlement:
        | { kind: "membership"; id: string; label: string }
        | { kind: "panty_order"; id: string; label: string }
        | { kind: "booking"; id: string; label: string }
        | null = null;
      if (membership) {
        entitlement = {
          kind: "membership",
          id: membership.id as string,
          label: membership.kind as string,
        };
      } else if (panty) {
        entitlement = {
          kind: "panty_order",
          id: panty.id as string,
          label: `panty order (${panty.status})`,
        };
      } else if (booking) {
        entitlement = {
          kind: "booking",
          id: booking.id as string,
          label: `booking ${booking.status}`,
        };
      }

      const userId = parsed?.userId ?? null;
      const user = userId ? userMap.get(userId) ?? null : null;

      return {
        payment_id: e.payment_id,
        last_status: e.last_status,
        order_id: e.order_id,
        handled: e.handled,
        reason: e.reason,
        received_count: e.received_count,
        first_seen_at: e.first_seen_at,
        last_seen_at: e.last_seen_at,
        processed_at: e.processed_at,
        // Signature: only signature-verified webhooks are ever written to this
        // ledger (invalid signatures return 401 before insert), so any stored
        // row is signature-verified by construction.
        signature_verified: true,
        parsed_order: parsed,
        user_id: userId,
        user_email: user?.email ?? null,
        user_display_name: user?.display_name ?? null,
        entitlement,
      };
    });

    const summary = {
      total: items.length,
      handled: items.filter((i) => i.handled).length,
      unhandled: items.filter((i) => !i.handled).length,
      finished: items.filter((i) => i.last_status === "finished").length,
    };

    return { items, summary };
  });

// ---------- Retry a failed / unhandled NOWPayments grant ----------
//
// Reprocesses the grant path for a previously received (and signature-verified)
// IPN event, keyed by payment_id. Idempotency is preserved by the underlying
// RPCs (grant_all_access_pass_30d / grant_lifetime_membership /
// grant_panty_listing_order all short-circuit on the unique
// external_payment_reference `nowpayments:<payment_id>`) and by the booking
// update guard (matches on id + no conflicting external_payment_reference).
// A retry can therefore never double-grant.
export const adminRetryNowpaymentsGrant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { paymentId: string }) => {
    if (!d?.paymentId || typeof d.paymentId !== "string") {
      throw new Error("paymentId required");
    }
    return { paymentId: d.paymentId.trim() };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Prefer a `finished` ledger row (that's the only status that grants), else
    // fall back to the most recent row for this payment_id.
    const { data: rows, error: loadErr } = await supabaseAdmin
      .from("nowpayments_ipn_events")
      .select("payment_id, last_status, order_id, payload, handled, reason")
      .eq("payment_id", data.paymentId)
      .order("last_seen_at", { ascending: false });
    if (loadErr) throw new Error(`load ipn event failed: ${loadErr.message}`);
    if (!rows || rows.length === 0) {
      throw new Error(`No IPN event found for payment_id ${data.paymentId}`);
    }

    const row =
      rows.find((r: { last_status: string }) => r.last_status === "finished") ?? rows[0];

    if (row.last_status !== "finished") {
      throw new Error(
        `Cannot retry: latest status is "${row.last_status}". Grants only run on payment_status="finished".`,
      );
    }

    const order = parseOrderId(row.order_id ?? undefined);
    if (!order) {
      throw new Error(`Cannot retry: order_id "${row.order_id ?? ""}" is unrecognised.`);
    }

    const paymentRef = `nowpayments:${data.paymentId}`;
    let outcome: { handled: boolean; reason?: string; entitlementId?: string | null };

    try {
      if (order.kind === "aap30d") {
        const { data: m, error } = await supabaseAdmin.rpc("grant_all_access_pass_30d", {
          _user_id: order.userId,
          _environment: order.environment,
          _amount_cents: order.amountCents,
          _external_payment_reference: paymentRef,
        });
        if (error) throw new Error(`grant_all_access_pass_30d failed: ${error.message}`);
        outcome = { handled: true, entitlementId: (m as { id?: string } | null)?.id ?? null };
      } else if (order.kind === "lifetime") {
        const { data: m, error } = await supabaseAdmin.rpc("grant_lifetime_membership", {
          _user_id: order.userId,
          _environment: order.environment,
          _amount_cents: order.amountCents,
          _external_payment_reference: paymentRef,
        });
        if (error) throw new Error(`grant_lifetime_membership failed: ${error.message}`);
        outcome = { handled: true, entitlementId: (m as { id?: string } | null)?.id ?? null };
      } else if (order.kind === "panty") {
        const { data: p, error } = await supabaseAdmin.rpc("grant_panty_listing_order", {
          _user_id: order.userId,
          _panty_listing_id: order.pantyListingId,
          _environment: order.environment,
          _amount_cents: order.amountCents,
          _external_payment_reference: paymentRef,
        });
        if (error) throw new Error(`grant_panty_listing_order failed: ${error.message}`);
        outcome = { handled: true, entitlementId: (p as { id?: string } | null)?.id ?? null };
      } else if (order.kind === "booking") {
        // booking — mirror the webhook's idempotent update.
        const { data: existing, error: fetchErr } = await supabaseAdmin
          .from("private_room_bookings")
          .select("id, status, external_payment_reference, user_id")
          .eq("id", order.bookingId)
          .maybeSingle();
        if (fetchErr) throw new Error(`booking lookup failed: ${fetchErr.message}`);
        if (!existing) {
          outcome = { handled: false, reason: "booking_not_found", entitlementId: null };
        } else if (existing.user_id !== order.userId) {
          outcome = { handled: false, reason: "booking_user_mismatch", entitlementId: existing.id };
        } else if (
          existing.external_payment_reference &&
          existing.external_payment_reference !== paymentRef
        ) {
          outcome = { handled: false, reason: "booking_already_paid", entitlementId: existing.id };
        } else if (
          existing.status === "confirmed" &&
          existing.external_payment_reference === paymentRef
        ) {
          outcome = { handled: true, entitlementId: existing.id };
        } else {
          const { error } = await supabaseAdmin
            .from("private_room_bookings")
            .update({
              status: "confirmed",
              external_payment_reference: paymentRef,
              amount_cents: order.amountCents,
              environment: order.environment,
            })
            .eq("id", order.bookingId);
          if (error) throw new Error(`confirm booking failed: ${error.message}`);
          outcome = { handled: true, entitlementId: existing.id };
        }
      } else {
        throw new Error(`Cannot retry: unsupported kind "${(order as { kind: string }).kind}"`);
      }

    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await supabaseAdmin
        .from("nowpayments_ipn_events")
        .update({
          reason: `retry_failed:${message.slice(0, 200)}`,
          last_seen_at: new Date().toISOString(),
        })
        .eq("payment_id", data.paymentId)
        .eq("last_status", row.last_status);

      await context.supabase.from("admin_activity_audit").insert({
        actor_id: context.userId,
        action: "retry_nowpayments_grant",
        resource: `nowpayments:${data.paymentId}`,
        metadata: {
          payment_id: data.paymentId,
          order_id: row.order_id,
          kind: order.kind,
          environment: order.environment,
          target_user_id: order.userId,
          external_payment_reference: paymentRef,
          previous_handled: row.handled,
          previous_reason: row.reason,
          outcome: "error",
          error: message,
        },
      });
      throw e;
    }

    await supabaseAdmin
      .from("nowpayments_ipn_events")
      .update({
        handled: outcome.handled,
        reason: outcome.reason ?? (outcome.handled ? null : row.reason),
        processed_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .eq("payment_id", data.paymentId)
      .eq("last_status", row.last_status);

    await context.supabase.from("admin_activity_audit").insert({
      actor_id: context.userId,
      action: "retry_nowpayments_grant",
      resource: `nowpayments:${data.paymentId}`,
      metadata: {
        payment_id: data.paymentId,
        order_id: row.order_id,
        kind: order.kind,
        environment: order.environment,
        target_user_id: order.userId,
        external_payment_reference: paymentRef,
        previous_handled: row.handled,
        previous_reason: row.reason,
        outcome: outcome.handled ? "handled" : "not_handled",
        reason: outcome.reason ?? null,
        entitlement_id: outcome.entitlementId ?? null,
      },
    });

    return {
      ok: true,
      handled: outcome.handled,
      reason: outcome.reason ?? null,
      paymentId: data.paymentId,
      kind: order.kind,
      entitlementId: outcome.entitlementId ?? null,
    };
  });



