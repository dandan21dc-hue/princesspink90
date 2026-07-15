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
        page?: number;
        pageSize?: number;
        status?: string;
        handled?: "all" | "handled" | "unhandled";
        reversal?: "all" | "any" | "revoked" | "suspended";
        search?: string;
        sort?:
          | "last_seen_desc"
          | "last_seen_asc"
          | "first_seen_desc"
          | "first_seen_asc"
          | "last_status_asc"
          | "last_status_desc"
          | "payment_id_asc"
          | "payment_id_desc";
      } = {},
    ) => {
      const pageSize = Math.min(Math.max(d.pageSize ?? d.limit ?? 50, 1), 500);
      const page = Math.max(d.page ?? 1, 1);
      return {
        limit: pageSize,
        page,
        pageSize,
        status: d.status?.trim() || undefined,
        handled: d.handled ?? "all",
        reversal: d.reversal ?? "all",
        search: d.search?.trim() || undefined,
        sort: d.sort ?? "last_seen_desc",
      };
    },
  )

  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Map the sort key → indexed column + direction. Every column below is
    // backed by an index on nowpayments_ipn_events so ORDER BY + range()
    // stays efficient at high volume.
    const SORT_MAP: Record<
      typeof data.sort,
      { column: "first_seen_at" | "last_seen_at" | "last_status" | "payment_id"; ascending: boolean }
    > = {
      last_seen_desc: { column: "last_seen_at", ascending: false },
      last_seen_asc: { column: "last_seen_at", ascending: true },
      first_seen_desc: { column: "first_seen_at", ascending: false },
      first_seen_asc: { column: "first_seen_at", ascending: true },
      last_status_asc: { column: "last_status", ascending: true },
      last_status_desc: { column: "last_status", ascending: false },
      payment_id_asc: { column: "payment_id", ascending: true },
      payment_id_desc: { column: "payment_id", ascending: false },
    };
    const { column: sortColumn, ascending: sortAscending } = SORT_MAP[data.sort];


    // Pre-resolve smart search into a set of matching payment_ids and/or
    // order_ids so we can combine it with the other filters via a single
    // .or(...) below. Search modes (auto-detected):
    //   • contains "@" → treat as buyer email; resolve to user_ids and
    //     find every payment_ref for their memberships / panty_orders /
    //     bookings.
    //   • looks like a UUID → treat as entitlement id (membership /
    //     panty_order / booking) and resolve to that row's
    //     external_payment_reference.
    //   • otherwise → ilike match on payment_id and order_id (previous
    //     behavior).
    const UUID_RE =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let extraPaymentIds: string[] | null = null;
    if (data.search) {
      const s = data.search;
      if (s.includes("@")) {
        const { data: users } = await supabaseAdmin.rpc(
          "admin_find_user_ids_by_email",
          { _email_pattern: s },
        );
        const matchedUserIds = (users ?? []).map((u: any) => u.user_id as string);
        if (matchedUserIds.length === 0) {
          extraPaymentIds = [];
        } else {
          const [{ data: mrows }, { data: prows }, { data: brows }] = await Promise.all([
            supabaseAdmin
              .from("memberships")
              .select("external_payment_reference")
              .in("user_id", matchedUserIds)
              .not("external_payment_reference", "is", null),
            supabaseAdmin
              .from("panty_orders")
              .select("external_payment_reference")
              .in("user_id", matchedUserIds)
              .not("external_payment_reference", "is", null),
            supabaseAdmin
              .from("private_room_bookings")
              .select("external_payment_reference")
              .in("user_id", matchedUserIds)
              .not("external_payment_reference", "is", null),
          ]);
          const refs = new Set<string>();
          for (const r of [...(mrows ?? []), ...(prows ?? []), ...(brows ?? [])]) {
            const ref = (r as any).external_payment_reference as string | null;
            if (ref?.startsWith("nowpayments:")) {
              refs.add(ref.slice("nowpayments:".length));
            }
          }
          extraPaymentIds = Array.from(refs);
        }
      } else if (UUID_RE.test(s)) {
        const [{ data: mrow }, { data: prow }, { data: brow }] = await Promise.all([
          supabaseAdmin
            .from("memberships")
            .select("external_payment_reference")
            .eq("id", s)
            .maybeSingle(),
          supabaseAdmin
            .from("panty_orders")
            .select("external_payment_reference")
            .eq("id", s)
            .maybeSingle(),
          supabaseAdmin
            .from("private_room_bookings")
            .select("external_payment_reference")
            .eq("id", s)
            .maybeSingle(),
        ]);
        const refs = new Set<string>();
        for (const r of [mrow, prow, brow]) {
          const ref = (r as any)?.external_payment_reference as string | null;
          if (ref?.startsWith("nowpayments:")) {
            refs.add(ref.slice("nowpayments:".length));
          }
        }
        extraPaymentIds = Array.from(refs);
      }
    }

    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;

    let q = supabaseAdmin
      .from("nowpayments_ipn_events")
      .select(
        "payment_id, last_status, order_id, handled, reason, payload, received_count, first_seen_at, last_seen_at, processed_at, admin_note, admin_note_updated_at, handled_updated_at",
        { count: "exact" },
      )

      .order(sortColumn, { ascending: sortAscending })
      // Stable tiebreaker on the composite pkey so pagination is deterministic
      // when the sort column has duplicate values (e.g. many rows share
      // last_status = 'finished').
      .order("payment_id", { ascending: true })
      .order("last_status", { ascending: true })
      .range(from, to);

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
      const s = data.search;
      const clauses: string[] = [];
      // Only apply text ilike when the search isn't clearly a UUID or email
      // (those modes are resolved to payment_ids above; adding an ilike would
      // silently widen results).
      const isUuid = UUID_RE.test(s);
      const isEmail = s.includes("@");
      if (!isUuid && !isEmail) {
        clauses.push(`payment_id.ilike.%${s}%`);
        clauses.push(`order_id.ilike.%${s}%`);
      }
      if (extraPaymentIds && extraPaymentIds.length > 0) {
        // PostgREST `in` operator inside `.or(...)` expects (a,b,c).
        clauses.push(`payment_id.in.(${extraPaymentIds.join(",")})`);
      }
      if (clauses.length === 0) {
        // Search yielded no candidates — short-circuit to an empty result set
        // instead of returning everything.
        return {
          items: [],
          summary: { total: 0, handled: 0, unhandled: 0, finished: 0, revoked: 0, suspended: 0 },
          page: data.page,
          pageSize: data.pageSize,
          totalCount: 0,
        };
      }
      q = q.or(clauses.join(","));
    }


    const { data: rows, error, count } = await q;
    if (error) throw new Error(error.message);
    const totalCount = count ?? 0;


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

      // Compute reversal outcome. Membership carries explicit revoked_at /
      // suspended_at columns. Panty orders and bookings reflect it in status.
      const isRevokeStatus = (REVERSAL_REVOKE_STATUSES as readonly string[]).includes(
        e.last_status,
      );
      const isSuspendStatus = (REVERSAL_SUSPEND_STATUSES as readonly string[]).includes(
        e.last_status,
      );
      let reversal:
        | {
            mode: "revoked" | "suspended";
            reason: string | null;
            at: string | null;
            applied: boolean;
          }
        | null = null;
      if (isRevokeStatus || isSuspendStatus) {
        const mode: "revoked" | "suspended" = isRevokeStatus ? "revoked" : "suspended";
        let at: string | null = null;
        let reason: string | null = null;
        let applied = false;
        if (membership) {
          const m = membership as any;
          at = mode === "revoked" ? m.revoked_at ?? null : m.suspended_at ?? null;
          reason = m.revocation_reason ?? null;
          applied = at !== null;
        } else if (panty) {
          const p = panty as any;
          applied =
            mode === "revoked" ? p.status === "refunded" : p.status === "disputed";
          at = applied ? p.updated_at ?? null : null;
        } else if (booking) {
          const b = booking as any;
          applied = b.status === "cancelled";
          at = applied ? b.updated_at ?? null : null;
        }
        reversal = { mode, reason, at, applied };
      }

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
        reversal,
        payload_json: e.payload == null ? null : JSON.stringify(e.payload),
        admin_note: (e as any).admin_note ?? null,
        admin_note_updated_at: (e as any).admin_note_updated_at ?? null,
        handled_updated_at: (e as any).handled_updated_at ?? null,
      };

    });


    const summary = {
      total: items.length,
      handled: items.filter((i) => i.handled).length,
      unhandled: items.filter((i) => !i.handled).length,
      finished: items.filter((i) => i.last_status === "finished").length,
      revoked: items.filter((i) => i.reversal?.mode === "revoked").length,
      suspended: items.filter((i) => i.reversal?.mode === "suspended").length,
    };

    return { items, summary, page: data.page, pageSize: data.pageSize, totalCount };
  });


// ---------- Bulk update NOWPayments IPN events ----------
//
// Applies one of a small set of admin actions to a list of (payment_id,
// last_status) rows in a single call:
//   • mark_handled   — set handled=true, clear reason
//   • mark_unhandled — set handled=false
//   • set_note       — write admin_note (empty string clears the note)
// Every mutation records the admin actor + timestamp on the row and inserts a
// single admin_activity_audit entry summarising the batch.
export type NowpaymentsBulkAction = "mark_handled" | "mark_unhandled" | "set_note";

export const adminBulkUpdateNowpaymentsEvents = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (d: {
      keys: Array<{ paymentId: string; lastStatus: string }>;
      action: NowpaymentsBulkAction;
      note?: string;
    }) => {
      if (!d || !Array.isArray(d.keys) || d.keys.length === 0) {
        throw new Error("keys required");
      }
      if (d.keys.length > 500) throw new Error("Too many rows (max 500 per batch)");
      const action = d.action;
      if (action !== "mark_handled" && action !== "mark_unhandled" && action !== "set_note") {
        throw new Error("action must be mark_handled | mark_unhandled | set_note");
      }
      const keys = d.keys.map((k) => {
        if (!k?.paymentId || !k?.lastStatus) throw new Error("each key needs paymentId + lastStatus");
        return { paymentId: String(k.paymentId), lastStatus: String(k.lastStatus) };
      });
      const note = action === "set_note" ? (d.note ?? "").slice(0, 2000) : undefined;
      return { keys, action, note };
    },
  )
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const now = new Date().toISOString();
    let updated = 0;
    const failed: Array<{ paymentId: string; lastStatus: string; error: string }> = [];

    for (const k of data.keys) {
      const patch: {
        handled?: boolean;
        reason?: string | null;
        handled_updated_at?: string;
        handled_updated_by?: string;
        admin_note?: string | null;
        admin_note_updated_at?: string;
        admin_note_updated_by?: string;
      } = {};
      if (data.action === "mark_handled") {
        patch.handled = true;
        patch.reason = null;
        patch.handled_updated_at = now;
        patch.handled_updated_by = context.userId;
      } else if (data.action === "mark_unhandled") {
        patch.handled = false;
        patch.handled_updated_at = now;
        patch.handled_updated_by = context.userId;
      } else {
        patch.admin_note = (data.note ?? "").trim() === "" ? null : data.note ?? null;
        patch.admin_note_updated_at = now;
        patch.admin_note_updated_by = context.userId;
      }
      const { error } = await supabaseAdmin
        .from("nowpayments_ipn_events")
        .update(patch)
        .eq("payment_id", k.paymentId)
        .eq("last_status", k.lastStatus);

      if (error) {
        failed.push({ paymentId: k.paymentId, lastStatus: k.lastStatus, error: error.message });
      } else {
        updated += 1;
      }
    }

    await context.supabase.from("admin_activity_audit").insert({
      actor_id: context.userId,
      action: `nowpayments_bulk_${data.action}`,
      resource: `nowpayments_ipn_events:${data.keys.length}`,
      metadata: {
        action: data.action,
        note: data.action === "set_note" ? data.note ?? null : undefined,
        requested: data.keys.length,
        updated,
        failed_count: failed.length,
        failed: failed.slice(0, 20),
      },
    });

    return { updated, failed, total: data.keys.length };
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


// ---------- Per-user access change timeline (admin) ----------
//
// Chronological view of every NOWPayments IPN event that touches a single
// user's entitlements — grants, revocations, suspensions, refused replays.
// Events are collected two ways so nothing is missed:
//   1. `order_id` parsed for a matching userId (covers events even if no
//      entitlement row was ever created — e.g. an unmatched reversal).
//   2. `external_payment_reference` matched against the user's memberships /
//      panty orders / bookings (covers events whose order_id is malformed).
//
// For each event we compute the action taken:
//   - grant      : `finished` event that produced an active entitlement row
//   - grant_noop : `finished` event whose grant did not apply (idempotent
//                  replay, later refused, or precondition failure)
//   - revoke     : refunded/reversed reversal that revoked an entitlement
//   - suspend    : chargeback/dispute reversal that suspended an entitlement
//   - reversal_no_match : reversal event whose payment ref matches nothing
//   - ignored    : non-terminal status (waiting/confirming/…) — kept for
//                  audit context but no entitlement effect
export type UserAccessTimelineEntry = {
  payment_id: string;
  status: string;
  order_id: string | null;
  handled: boolean;
  reason: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  processed_at: string | null;
  received_count: number;
  action:
    | "grant"
    | "grant_noop"
    | "revoke"
    | "suspend"
    | "reversal_no_match"
    | "ignored";
  action_detail: string;
  entitlement:
    | { kind: "membership"; id: string; label: string; revoked_at: string | null; suspended_at: string | null }
    | { kind: "panty_order"; id: string; label: string }
    | { kind: "booking"; id: string; label: string }
    | null;
  amount_cents: number | null;
  currency: string | null;
};

export const adminGetUserAccessTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; limit?: number }) => {
    if (!d.userId || !NPE_UUID_RE.test(d.userId)) {
      throw new Error("Valid userId (uuid) is required");
    }
    return {
      userId: d.userId,
      limit: Math.min(Math.max(d.limit ?? 200, 1), 1000),
    };
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // 1) All entitlement rows owned by this user, mapped by payment_ref.
    const [
      { data: memberships },
      { data: pantyOrders },
      { data: bookings },
    ] = await Promise.all([
      supabaseAdmin
        .from("memberships")
        .select(
          "id, user_id, kind, environment, amount_cents, expires_at, external_payment_reference, revoked_at, suspended_at, revocation_reason, created_at",
        )
        .eq("user_id", data.userId),
      supabaseAdmin
        .from("panty_orders")
        .select(
          "id, user_id, panty_listing_id, variant, status, environment, amount_cents, currency, external_payment_reference, created_at, updated_at",
        )
        .eq("user_id", data.userId),
      supabaseAdmin
        .from("private_room_bookings")
        .select(
          "id, user_id, status, starts_at, duration_minutes, environment, amount_cents, external_payment_reference, created_at, updated_at",
        )
        .eq("user_id", data.userId),
    ]);

    const membershipByRef = new Map<string, any>();
    for (const m of memberships ?? []) {
      if (m.external_payment_reference) membershipByRef.set(m.external_payment_reference, m);
    }
    const pantyByRef = new Map<string, any>();
    for (const p of pantyOrders ?? []) {
      if (p.external_payment_reference) pantyByRef.set(p.external_payment_reference, p);
    }
    const bookingByRef = new Map<string, any>();
    for (const b of bookings ?? []) {
      if (b.external_payment_reference) bookingByRef.set(b.external_payment_reference, b);
    }

    const refs = [
      ...membershipByRef.keys(),
      ...pantyByRef.keys(),
      ...bookingByRef.keys(),
    ];

    // 2) Two queries against ipn events: by order_id containing userId, and
    // by payment_id derived from the user's payment refs. Dedupe on payment_id.
    const paymentIdsFromRefs = refs
      .map((r) => (r.startsWith("nowpayments:") ? r.slice("nowpayments:".length) : null))
      .filter((v): v is string => v != null);

    const [{ data: byOrder }, { data: byRef }] = await Promise.all([
      supabaseAdmin
        .from("nowpayments_ipn_events")
        .select(
          "payment_id, last_status, order_id, handled, reason, received_count, first_seen_at, last_seen_at, processed_at, payload",
        )
        .ilike("order_id", `%:${data.userId}:%`)
        .order("first_seen_at", { ascending: true })
        .limit(data.limit),
      paymentIdsFromRefs.length
        ? supabaseAdmin
            .from("nowpayments_ipn_events")
            .select(
              "payment_id, last_status, order_id, handled, reason, received_count, first_seen_at, last_seen_at, processed_at, payload",
            )
            .in("payment_id", paymentIdsFromRefs)
            .order("first_seen_at", { ascending: true })
            .limit(data.limit)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const seen = new Set<string>();
    const combined: any[] = [];
    for (const row of [...(byOrder ?? []), ...(byRef ?? [])]) {
      const key = `${row.payment_id}|${row.last_status}`;
      if (seen.has(key)) continue;
      seen.add(key);
      combined.push(row);
    }
    combined.sort((a, b) => {
      const ta = a.first_seen_at ? new Date(a.first_seen_at).getTime() : 0;
      const tb = b.first_seen_at ? new Date(b.first_seen_at).getTime() : 0;
      return ta - tb;
    });

    const items: UserAccessTimelineEntry[] = combined.map((e: any) => {
      const parsed = parseOrderId(e.order_id ?? undefined);
      const ref = `nowpayments:${e.payment_id}`;
      const membership = membershipByRef.get(ref) ?? null;
      const panty = pantyByRef.get(ref) ?? null;
      const booking = bookingByRef.get(ref) ?? null;

      let entitlement: UserAccessTimelineEntry["entitlement"] = null;
      if (membership) {
        entitlement = {
          kind: "membership",
          id: membership.id,
          label: membership.kind,
          revoked_at: membership.revoked_at ?? null,
          suspended_at: membership.suspended_at ?? null,
        };
      } else if (panty) {
        entitlement = {
          kind: "panty_order",
          id: panty.id,
          label: `panty order (${panty.status})`,
        };
      } else if (booking) {
        entitlement = {
          kind: "booking",
          id: booking.id,
          label: `booking ${booking.status}`,
        };
      }

      const status = String(e.last_status ?? "").toLowerCase();
      const isRevoke = (REVERSAL_REVOKE_STATUSES as readonly string[]).includes(status);
      const isSuspend = (REVERSAL_SUSPEND_STATUSES as readonly string[]).includes(status);

      let action: UserAccessTimelineEntry["action"] = "ignored";
      let action_detail = "";

      if (status === "finished") {
        // The webhook stores `reason` describing the grant outcome.
        // A missing entitlement snapshot means the grant never materialised —
        // either refused (late finished after reversal) or handled=false.
        if (e.handled && entitlement) {
          action = "grant";
          const kindLabel =
            entitlement.kind === "membership"
              ? membership?.kind ?? "membership"
              : entitlement.kind === "panty_order"
                ? "panty order"
                : "private room booking";
          action_detail = `Granted ${kindLabel}${
            membership?.expires_at ? ` (expires ${membership.expires_at})` : ""
          }`;
        } else {
          action = "grant_noop";
          action_detail = e.reason ?? "Finished event did not produce an entitlement";
        }
      } else if (isRevoke || isSuspend) {
        const mode: "revoked" | "suspended" = isRevoke ? "revoked" : "suspended";
        // Applied when the entitlement carries a matching marker or a
        // matching terminal status.
        let applied = false;
        if (membership) {
          applied =
            mode === "revoked"
              ? membership.revoked_at != null
              : membership.suspended_at != null;
        } else if (panty) {
          applied =
            mode === "revoked"
              ? panty.status === "refunded"
              : panty.status === "disputed";
        } else if (booking) {
          applied = booking.status === "cancelled";
        }

        if (!membership && !panty && !booking) {
          action = "reversal_no_match";
          action_detail = `${mode === "revoked" ? "Refund/reversal" : "Chargeback/dispute"} arrived (${status}) but no matching entitlement was found`;
        } else if (applied) {
          action = mode === "revoked" ? "revoke" : "suspend";
          action_detail =
            mode === "revoked"
              ? `Revoked ${entitlement?.label ?? "entitlement"}`
              : `Suspended ${entitlement?.label ?? "entitlement"}`;
        } else {
          action = "grant_noop";
          action_detail = e.reason ?? `Reversal (${status}) received but not applied`;
        }
      } else {
        action = "ignored";
        action_detail = `Non-terminal status ${status || "unknown"} — no entitlement effect`;
      }

      const amountCents =
        parsed && "amountCents" in parsed
          ? parsed.amountCents
          : membership?.amount_cents ??
            panty?.amount_cents ??
            booking?.amount_cents ??
            null;
      const currency = panty?.currency ?? null;

      return {
        payment_id: e.payment_id,
        status,
        order_id: e.order_id ?? null,
        handled: Boolean(e.handled),
        reason: e.reason ?? null,
        first_seen_at: e.first_seen_at ?? null,
        last_seen_at: e.last_seen_at ?? null,
        processed_at: e.processed_at ?? null,
        received_count: e.received_count ?? 1,
        action,
        action_detail,
        entitlement,
        amount_cents: amountCents,
        currency,
      };
    });

    // Resolve user profile/email for the header.
    let profile: { display_name: string | null; email: string | null } = {
      display_name: null,
      email: null,
    };
    const { data: p } = await supabaseAdmin
      .from("profiles")
      .select("display_name")
      .eq("user_id", data.userId)
      .maybeSingle();
    profile.display_name = (p as any)?.display_name ?? null;
    try {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.userId);
      profile.email = u?.user?.email ?? null;
    } catch {
      /* best-effort */
    }

    const summary = {
      total: items.length,
      grants: items.filter((i) => i.action === "grant").length,
      revokes: items.filter((i) => i.action === "revoke").length,
      suspends: items.filter((i) => i.action === "suspend").length,
      noops: items.filter((i) => i.action === "grant_noop" || i.action === "reversal_no_match").length,
      active_memberships: (memberships ?? []).filter(
        (m: any) =>
          m.revoked_at == null &&
          m.suspended_at == null &&
          (m.kind === "lifetime" ||
            (typeof m.expires_at === "string" && new Date(m.expires_at).getTime() > Date.now())),
      ).length,
    };

    return { userId: data.userId, profile, items, summary };
  });

// ---------- CRM: user detail + staff notes + account restriction ----------

export const listAllUsersForCrm = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const users: Array<{
      id: string;
      email: string | null;
      created_at: string | null;
      display_name: string | null;
      account_restricted: boolean;
    }> = [];

    let page = 1;
    const perPage = 200;
    for (let i = 0; i < 20; i++) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(error.message);
      for (const u of data.users) {
        users.push({
          id: u.id,
          email: u.email ?? null,
          created_at: u.created_at ?? null,
          display_name: null,
          account_restricted: false,
        });
      }
      if (data.users.length < perPage) break;
      page += 1;
    }

    if (users.length === 0) return { users };

    const ids = users.map((u) => u.id);
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name, account_restricted")
      .in("user_id", ids);
    const pmap = new Map((profiles ?? []).map((p) => [p.user_id, p]));
    for (const u of users) {
      const p = pmap.get(u.id);
      u.display_name = p?.display_name ?? null;
      u.account_restricted = Boolean(p?.account_restricted);
    }
    users.sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
    return { users };
  });

export const getCrmUserDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string }) => {
    if (!data?.userId) throw new Error("userId required");
    return data;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("user_id, display_name, account_restricted, created_at")
      .eq("user_id", data.userId)
      .maybeSingle();
    const { data: staffNotesRow } = await supabaseAdmin
      .from("profile_staff_notes")
      .select("notes")
      .eq("user_id", data.userId)
      .maybeSingle();


    const [{ data: rsvps }, { data: roomBookings }, { data: pantyOrders }, { data: memberships }] =
      await Promise.all([
        supabaseAdmin
          .from("rsvps")
          .select("id, event_id, created_at, guest_count, entry_code, entry_phrase, checked_in_at, events:event_id(title, starts_at)")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabaseAdmin
          .from("private_room_bookings")
          .select("id, starts_at, duration_minutes, status, created_at, amount_cents")
          .eq("user_id", data.userId)
          .order("starts_at", { ascending: false })
          .limit(100),
        supabaseAdmin
          .from("panty_orders")
          .select("id, variant, status, amount_cents, currency, created_at")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(100),
        supabaseAdmin
          .from("memberships")
          .select("id, kind, environment, amount_cents, expires_at, revoked_at, suspended_at, created_at")
          .eq("user_id", data.userId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

    return {
      user: {
        id: data.userId,
        email: authUser?.user?.email ?? null,
        created_at: authUser?.user?.created_at ?? profile?.created_at ?? null,
        display_name: profile?.display_name ?? null,
        staff_notes: staffNotesRow?.notes ?? "",
        account_restricted: Boolean(profile?.account_restricted),
      },
      rsvps: rsvps ?? [],
      room_bookings: roomBookings ?? [],
      panty_orders: pantyOrders ?? [],
      memberships: memberships ?? [],
    };
  });

export const updateCrmStaffNotes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; staff_notes: string }) => {
    if (!data?.userId) throw new Error("userId required");
    if (typeof data.staff_notes !== "string") throw new Error("staff_notes must be a string");
    if (data.staff_notes.length > 10000) throw new Error("staff_notes too long (max 10000 chars)");
    return data;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ staff_notes: data.staff_notes })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setCrmAccountRestricted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; restricted: boolean }) => {
    if (!data?.userId) throw new Error("userId required");
    if (typeof data.restricted !== "boolean") throw new Error("restricted must be boolean");
    return data;
  })
  .handler(async ({ context, data }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin
      .from("profiles")
      .update({ account_restricted: data.restricted })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });





