import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

// -------------------- Public (authenticated) --------------------

/** Active rewards, sorted cheapest first. RLS already filters inactive
 *  rows for non-admins; we still `.eq("is_active", true)` so admins get
 *  the same view when they use the gallery. */
export const listActiveRewards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("rewards_catalog")
      .select("id, name, description, image_url, points_cost, is_active")
      .eq("is_active", true)
      .order("points_cost", { ascending: true });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

/** Atomically deduct the caller's reward points and create a pending
 *  redemption row. Errors are surfaced verbatim so the UI can distinguish
 *  insufficient balance from an inactive reward. */
export const redeemReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ rewardId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin.rpc("redeem_reward", {
      _reward_id: data.rewardId,
      _caller: context.userId,
    });
    if (error) {
      const msg = error.message || "";
      if (/insufficient_reward_points/.test(msg)) {
        throw new Error("You don't have enough reward points.");
      }
      if (/reward_inactive/.test(msg)) {
        throw new Error("That reward isn't available right now.");
      }
      if (/reward_not_found/.test(msg)) {
        throw new Error("That reward no longer exists.");
      }
      throw new Error(msg || "Redemption failed");
    }
    const redemption = row as {
      id: string;
      reward_id: string;
      reward_name: string;
      points_spent: number;
      status: string;
      created_at: string;
    };

    // Fire-and-forget admin alert. Never block or fail the redemption on
    // an email error — the pending row is already the source of truth.
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: settings } = await supabaseAdmin
        .from("site_settings")
        .select("admin_reward_alerts_enabled, admin_reward_alert_email, email")
        .eq("id", "host")
        .maybeSingle();
      const enabled = (settings as any)?.admin_reward_alerts_enabled === true;
      const recipient =
        ((settings as any)?.admin_reward_alert_email as string | null) ||
        ((settings as any)?.email as string | null) ||
        null;
      if (enabled && recipient) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("user_id", context.userId)
          .maybeSingle();
        let memberEmail: string | undefined;
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(context.userId);
          memberEmail = u?.user?.email ?? undefined;
        } catch {
          /* ignore */
        }
        const { enqueueTemplateEmail } = await import("@/lib/email/enqueue.server");
        await enqueueTemplateEmail({
          templateName: "admin-reward-redeemed",
          recipientEmail: recipient,
          idempotencyKey: `admin-reward-redeemed-${redemption.id}`,
          templateData: {
            rewardName: redemption.reward_name,
            pointsSpent: redemption.points_spent,
            memberEmail,
            memberDisplayName: (profile as any)?.display_name ?? undefined,
            redeemedAt: redemption.created_at,
            fulfillUrl: "https://princesspink90.com/admin/rewards",
          },
        });
      }
    } catch (e) {
      console.error("redeemReward: admin alert enqueue failed", e);
    }

    return redemption;
  });

export const listMyRedemptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("user_rewards")
      .select("id, reward_id, reward_name, points_spent, status, created_at, fulfilled_at")
      .eq("user_id", context.userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    return data ?? [];
  });

// -------------------- Admin --------------------

export const adminListRewards = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("rewards_catalog")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

const rewardInput = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  image_url: z.string().trim().url().max(500).optional().or(z.literal("")),
  points_cost: z.number().int().positive().max(10_000_000),
  is_active: z.boolean().optional(),
});

export const adminUpsertReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => rewardInput.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const payload = {
      name: data.name,
      description: data.description || null,
      image_url: data.image_url || null,
      points_cost: data.points_cost,
      is_active: data.is_active ?? true,
    };
    if (data.id) {
      const { data: row, error } = await context.supabase
        .from("rewards_catalog")
        .update(payload)
        .eq("id", data.id)
        .select("*")
        .single();
      if (error) throw new Error(error.message);
      return row;
    }
    const { data: row, error } = await context.supabase
      .from("rewards_catalog")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminDeleteReward = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("rewards_catalog")
      .delete()
      .eq("id", data.id);
    if (error) {
      // FK restrict → reward already redeemed; deactivate instead so history stays intact.
      if (/foreign key|violates/i.test(error.message)) {
        throw new Error(
          "This reward has been redeemed by members and can't be deleted. Deactivate it instead.",
        );
      }
      throw new Error(error.message);
    }
    return { ok: true };
  });

export const adminToggleRewardActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("rewards_catalog")
      .update({ is_active: data.isActive })
      .eq("id", data.id)
      .select("id, is_active")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const adminListPendingRedemptions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("user_rewards")
      .select("id, user_id, reward_id, reward_name, points_spent, status, created_at")
      .eq("status", "pending")
      .order("created_at", { ascending: true });
    if (error) throw new Error(error.message);

    // Enrich with a display name / email for admins. Uses admin API so it
    // works regardless of profiles visibility policies.
    const ids = Array.from(new Set((data ?? []).map((r: any) => r.user_id)));
    const users: Record<string, { email?: string; display_name?: string }> = {};
    if (ids.length > 0) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      for (const p of profiles ?? []) {
        users[p.user_id as string] = { display_name: p.display_name ?? undefined };
      }
      for (const uid of ids) {
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(uid);
          if (u?.user?.email) {
            users[uid] = { ...(users[uid] ?? {}), email: u.user.email };
          }
        } catch {
          /* ignore */
        }
      }
    }
    return (data ?? []).map((r: any) => ({ ...r, user: users[r.user_id] ?? {} }));
  });

export const adminFulfillRedemption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        id: z.string().uuid(),
        notes: z.string().trim().max(1000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("user_rewards")
      .update({
        status: "fulfilled",
        fulfilled_at: new Date().toISOString(),
        fulfilled_by: context.userId,
        admin_notes: data.notes ?? null,
      })
      .eq("id", data.id)
      .eq("status", "pending")
      .select("id, status, fulfilled_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

// -------------------- Admin reward-alert prefs --------------------

export type AdminRewardAlertPrefs = {
  enabled: boolean;
  email: string | null;
  fallback_email: string | null;
};

export const getAdminRewardAlertPrefs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AdminRewardAlertPrefs> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin
      .from("site_settings")
      .select("admin_reward_alerts_enabled, admin_reward_alert_email, email")
      .eq("id", "host")
      .maybeSingle();
    const row = (data ?? {}) as {
      admin_reward_alerts_enabled?: boolean | null;
      admin_reward_alert_email?: string | null;
      email?: string | null;
    };
    return {
      enabled: row.admin_reward_alerts_enabled === true,
      email: row.admin_reward_alert_email ?? null,
      fallback_email: row.email ?? null,
    };
  });

export const updateAdminRewardAlertPrefs = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data) =>
    z
      .object({
        enabled: z.boolean(),
        email: z
          .string()
          .trim()
          .max(255)
          .email("Enter a valid email address.")
          .nullable()
          .optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // If enabling, require an alert email OR a fallback contact email.
    if (data.enabled) {
      const alertEmail = data.email?.trim() || null;
      if (!alertEmail) {
        const { data: current } = await context.supabase
          .from("site_settings")
          .select("email")
          .eq("id", "host")
          .maybeSingle();
        const fallback = (current as any)?.email as string | null | undefined;
        if (!fallback) {
          throw new Error(
            "Set an alert email (or a contact email in Settings) before enabling alerts.",
          );
        }
      }
    }
    const { error } = await context.supabase
      .from("site_settings")
      .update({
        admin_reward_alerts_enabled: data.enabled,
        admin_reward_alert_email: data.email?.trim() || null,
      })
      .eq("id", "host");
    if (error) throw new Error(error.message);
    return { ok: true };
  });
