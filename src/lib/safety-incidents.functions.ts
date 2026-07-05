import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

const listSchema = z.object({
  search: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(500).default(200),
});

export const listSafetyIncidents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    let q = context.supabase
      .from("safety_incident_reports")
      .select("id, incident_date, venue, involved_party, nature_of_incident, resolution_taken, created_at, updated_at, created_by")
      .order("incident_date", { ascending: false })
      .limit(data.limit);

    if (data.search) {
      const s = data.search.replace(/[%,]/g, " ").trim();
      const like = `%${s}%`;
      q = q.or(
        [
          `venue.ilike.${like}`,
          `involved_party.ilike.${like}`,
          `nature_of_incident.ilike.${like}`,
          `resolution_taken.ilike.${like}`,
        ].join(","),
      );
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    return { rows: rows ?? [] };
  });

const createSchema = z.object({
  incident_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD"),
  venue: z.string().trim().min(1).max(200),
  involved_party: z.string().trim().min(1).max(300),
  nature_of_incident: z.string().trim().min(1).max(4000),
  resolution_taken: z.string().trim().min(1).max(4000),
});

export const createSafetyIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("safety_incident_reports")
      .insert({ ...data, created_by: context.userId })
      .select()
      .single();
    if (error) throw error;
    return { row };
  });

const deleteSchema = z.object({ id: z.string().uuid() });

export const deleteSafetyIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await context.supabase
      .from("safety_incident_reports")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
