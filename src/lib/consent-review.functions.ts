import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

export type ConsentSubmissionRow = {
  kind: "policy_agreement" | "waiver";
  id: string;
  at: string;
  user_id: string;
  user_display_name: string | null;
  event_id: string | null;
  event_title: string | null;
  policy_version_label: string | null;
  action: string | null;
  ip_address: string | null;
  user_agent: string | null;
};

export const listConsentSubmissions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { limit?: number; kind?: "all" | "policy_agreement" | "waiver" } | undefined) =>
    z
      .object({
        limit: z.number().int().min(1).max(500).optional(),
        kind: z.enum(["all", "policy_agreement", "waiver"]).optional(),
      })
      .optional()
      .parse(data),
  )
  .handler(async ({ data, context }): Promise<ConsentSubmissionRow[]> => {
    await assertAdmin(context.supabase, context.userId);
    const limit = data?.limit ?? 200;
    const kind = data?.kind ?? "all";

    const rows: ConsentSubmissionRow[] = [];

    if (kind === "all" || kind === "policy_agreement") {
      const { data: agreements, error } = await context.supabase
        .from("compliance_policy_agreements")
        .select("id, accepted_at, accepted_by_user_id, event_id, policy_version_label, ip_address, user_agent")
        .order("accepted_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      for (const a of agreements ?? []) {
        rows.push({
          kind: "policy_agreement",
          id: a.id,
          at: a.accepted_at,
          user_id: a.accepted_by_user_id,
          user_display_name: null,
          event_id: a.event_id,
          event_title: null,
          policy_version_label: a.policy_version_label,
          action: "agreed",
          ip_address: a.ip_address,
          user_agent: a.user_agent,
        });
      }
    }

    if (kind === "all" || kind === "waiver") {
      const { data: waivers, error } = await context.supabase
        .from("waiver_audit_log")
        .select("id, created_at, user_id, event_id, action, ip_address, user_agent")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      for (const w of waivers ?? []) {
        rows.push({
          kind: "waiver",
          id: w.id,
          at: w.created_at,
          user_id: w.user_id,
          user_display_name: null,
          event_id: w.event_id,
          event_title: null,
          policy_version_label: null,
          action: w.action,
          ip_address: w.ip_address,
          user_agent: w.user_agent,
        });
      }
    }

    // Enrich with profile display names + event titles
    const userIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const eventIds = Array.from(new Set(rows.map((r) => r.event_id).filter((v): v is string => !!v)));

    if (userIds.length) {
      const { data: profiles } = await context.supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", userIds);
      const byId = new Map((profiles ?? []).map((p: any) => [p.user_id, p.display_name]));
      for (const r of rows) r.user_display_name = byId.get(r.user_id) ?? null;
    }

    if (eventIds.length) {
      const { data: events } = await context.supabase
        .from("events")
        .select("id, title")
        .in("id", eventIds);
      const byId = new Map((events ?? []).map((e: any) => [e.id, e.title]));
      for (const r of rows) if (r.event_id) r.event_title = byId.get(r.event_id) ?? null;
    }

    rows.sort((a, b) => (a.at < b.at ? 1 : -1));
    return rows.slice(0, limit);
  });
