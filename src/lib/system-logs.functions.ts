import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type SystemLogEvent = {
  id: string;
  kind: "rsvp" | "health_approved" | "cohost_applied" | "incident";
  label: string;
  detail: string;
  at: string;
};

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden");
}

export const getSystemLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const limit = 100;

    const [rsvpsRes, healthRes, cohostRes, incidentRes] = await Promise.all([
      supabaseAdmin
        .from("rsvps")
        .select("id, guest_count, created_at, event_id")
        .order("created_at", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("health_screenings")
        .select("id, reviewed_at, valid_until")
        .eq("status", "approved")
        .not("reviewed_at", "is", null)
        .order("reviewed_at", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("cohost_applications")
        .select("id, display_name, city, submitted_at")
        .order("submitted_at", { ascending: false })
        .limit(limit),
      supabaseAdmin
        .from("safety_incident_reports")
        .select("id, venue, nature_of_incident, created_at")
        .order("created_at", { ascending: false })
        .limit(limit),
    ]);

    const events: SystemLogEvent[] = [];

    for (const r of rsvpsRes.data ?? []) {
      events.push({
        id: `rsvp-${r.id}`,
        kind: "rsvp",
        label: "New Guest RSVP",
        detail:
          r.guest_count && r.guest_count > 1
            ? `${r.guest_count} guests confirmed`
            : "Guest confirmed",
        at: r.created_at,
      });
    }
    for (const h of healthRes.data ?? []) {
      events.push({
        id: `health-${h.id}`,
        kind: "health_approved",
        label: "Health Check Approved",
        detail: h.valid_until ? `Valid until ${h.valid_until}` : "Screening approved",
        at: h.reviewed_at as string,
      });
    }
    for (const c of cohostRes.data ?? []) {
      events.push({
        id: `cohost-${c.id}`,
        kind: "cohost_applied",
        label: "Co-Host Applied",
        detail: [c.display_name, c.city].filter(Boolean).join(" · ") || "Application submitted",
        at: c.submitted_at,
      });
    }
    for (const i of incidentRes.data ?? []) {
      events.push({
        id: `incident-${i.id}`,
        kind: "incident",
        label: "Incident Reported",
        detail: [i.venue, i.nature_of_incident].filter(Boolean).join(" · ").slice(0, 160),
        at: i.created_at,
      });
    }

    events.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return events.slice(0, 200);
  });

export type SystemLogDetail = {
  id: string;
  kind: SystemLogEvent["kind"];
  label: string;
  at: string;
  summary: string;
  payload: Record<string, unknown>;
};

const detailInput = z.object({
  kind: z.enum(["rsvp", "health_approved", "cohost_applied", "incident"]),
  id: z.string().uuid(),
});

export const getSystemLogDetail = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof detailInput>) => detailInput.parse(input))
  .handler(async ({ data, context }): Promise<SystemLogDetail> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    if (data.kind === "rsvp") {
      const { data: row, error } = await supabaseAdmin
        .from("rsvps")
        .select("*, events:event_id(id, title, venue_name, starts_at)")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("RSVP not found");
      return {
        id: `rsvp-${row.id}`,
        kind: "rsvp",
        label: "New Guest RSVP",
        at: row.created_at as string,
        summary: `Guest RSVP · ${row.guest_count ?? 1} guest(s)`,
        payload: row as Record<string, unknown>,
      };
    }

    if (data.kind === "health_approved") {
      const { data: row, error } = await supabaseAdmin
        .from("health_screenings")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("Health screening not found");
      return {
        id: `health-${row.id}`,
        kind: "health_approved",
        label: "Health Check Approved",
        at: (row.reviewed_at ?? row.submitted_at) as string,
        summary: row.valid_until ? `Valid until ${row.valid_until}` : "Screening approved",
        payload: row as Record<string, unknown>,
      };
    }

    if (data.kind === "cohost_applied") {
      const { data: row, error } = await supabaseAdmin
        .from("cohost_applications")
        .select("*")
        .eq("id", data.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error("Co-host application not found");
      return {
        id: `cohost-${row.id}`,
        kind: "cohost_applied",
        label: "Co-Host Applied",
        at: row.submitted_at as string,
        summary: [row.display_name, row.city].filter(Boolean).join(" · ") || "Application submitted",
        payload: row as Record<string, unknown>,
      };
    }

    // incident
    const { data: row, error } = await supabaseAdmin
      .from("safety_incident_reports")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("Incident not found");
    return {
      id: `incident-${row.id}`,
      kind: "incident",
      label: "Incident Reported",
      at: row.created_at as string,
      summary: [row.venue, row.nature_of_incident].filter(Boolean).join(" · "),
      payload: row as Record<string, unknown>,
    };
  });
