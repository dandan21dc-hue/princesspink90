import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const BUCKET = "safety-incident-attachments";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");
const listSchema = z.object({
  search: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(500).default(200),
  include_archived: z.boolean().default(false),
  only_archived: z.boolean().default(false),
  from_date: dateStr.optional().nullable(),
  to_date: dateStr.optional().nullable(),
});

export const listSafetyIncidents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;

    // If searching, first find incident IDs whose attachments match the query
    let attachmentIncidentIds: string[] = [];
    if (data.search) {
      const s = data.search.replace(/[%,]/g, " ").trim();
      const like = `%${s}%`;
      const { data: att, error: aErr } = await sb
        .from("safety_incident_attachments")
        .select("incident_id")
        .or(`file_name.ilike.${like},description.ilike.${like}`);
      if (aErr) throw aErr;
      attachmentIncidentIds = Array.from(
        new Set((att ?? []).map((r: any) => r.incident_id)),
      );
    }

    let q = sb
      .from("safety_incident_reports")
      .select(
        "id, incident_date, venue, involved_party, nature_of_incident, resolution_taken, created_at, updated_at, created_by, archived_at, archived_by, archive_reason, safety_incident_attachments(count)",
      )
      .order("incident_date", { ascending: false })
      .limit(data.limit);

    if (data.only_archived) {
      q = q.not("archived_at", "is", null);
    } else if (!data.include_archived) {
      q = q.is("archived_at", null);
    }

    if (data.from_date) q = q.gte("incident_date", data.from_date);
    if (data.to_date) q = q.lte("incident_date", data.to_date);


    if (data.search) {
      const s = data.search.replace(/[%,]/g, " ").trim();
      const like = `%${s}%`;
      const orClauses = [
        `venue.ilike.${like}`,
        `involved_party.ilike.${like}`,
        `nature_of_incident.ilike.${like}`,
        `resolution_taken.ilike.${like}`,
        `archive_reason.ilike.${like}`,
      ];
      if (attachmentIncidentIds.length > 0) {
        orClauses.push(`id.in.(${attachmentIncidentIds.join(",")})`);
      }
      q = q.or(orClauses.join(","));
    }
    const { data: rows, error } = await q;
    if (error) throw error;
    const shaped = (rows ?? []).map((r: any) => ({
      ...r,
      attachment_count:
        Array.isArray(r.safety_incident_attachments) &&
        r.safety_incident_attachments[0]
          ? r.safety_incident_attachments[0].count
          : 0,
      safety_incident_attachments: undefined,
    }));
    return { rows: shaped };
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
    const { data: row, error } = await (context.supabase as any)
      .from("safety_incident_reports")
      .insert({ ...data, created_by: context.userId })
      .select()
      .single();
    if (error) throw error;
    return { row };
  });

const archiveSchema = z.object({
  id: z.string().uuid(),
  reason: z.string().trim().min(3, "Provide a reason (min 3 chars)").max(1000),
});

export const archiveSafetyIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => archiveSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: existing, error: fetchErr } = await (context.supabase as any)
      .from("safety_incident_reports")
      .select("id, archived_at")
      .eq("id", data.id)
      .single();
    if (fetchErr) throw fetchErr;
    if (existing?.archived_at) throw new Error("Record is already archived");

    const { error } = await (context.supabase as any)
      .from("safety_incident_reports")
      .update({
        archived_at: new Date().toISOString(),
        archived_by: context.userId,
        archive_reason: data.reason,
      })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

const restoreSchema = z.object({ id: z.string().uuid() });

export const restoreSafetyIncident = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => restoreSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { error } = await (context.supabase as any)
      .from("safety_incident_reports")
      .update({ archived_at: null, archived_by: null, archive_reason: null })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

// ---------- Attachments ----------

const listAttachmentsSchema = z.object({ incident_id: z.string().uuid() });

export const listIncidentAttachments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listAttachmentsSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    const { data: rows, error } = await sb
      .from("safety_incident_attachments")
      .select("id, incident_id, file_path, file_name, mime_type, size_bytes, description, uploaded_by, created_at")
      .eq("incident_id", data.incident_id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const withUrls = await Promise.all(
      (rows ?? []).map(async (r: any) => {
        const { data: signed } = await sb.storage
          .from(BUCKET)
          .createSignedUrl(r.file_path, 60 * 10); // 10 minutes
        return { ...r, signed_url: signed?.signedUrl ?? null };
      }),
    );
    return { rows: withUrls };
  });

const createUploadUrlSchema = z.object({
  incident_id: z.string().uuid(),
  file_name: z.string().trim().min(1).max(255),
});

export const createIncidentAttachmentUploadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createUploadUrlSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    // Verify the incident exists
    const { data: inc, error: incErr } = await sb
      .from("safety_incident_reports")
      .select("id")
      .eq("id", data.incident_id)
      .single();
    if (incErr || !inc) throw new Error("Incident not found");

    const safeName = data.file_name.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 200);
    const filePath = `${data.incident_id}/${Date.now()}_${crypto.randomUUID()}_${safeName}`;
    const { data: signed, error } = await sb.storage
      .from(BUCKET)
      .createSignedUploadUrl(filePath);
    if (error) throw error;
    return {
      file_path: filePath,
      signed_url: signed.signedUrl,
      token: signed.token,
    };
  });

const recordAttachmentSchema = z.object({
  incident_id: z.string().uuid(),
  file_path: z.string().min(1).max(1000),
  file_name: z.string().trim().min(1).max(255),
  mime_type: z.string().trim().max(200).optional().nullable(),
  size_bytes: z.number().int().nonnegative().max(100 * 1024 * 1024).optional().nullable(),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const recordIncidentAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => recordAttachmentSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    // Guard: file_path must be scoped to this incident's folder
    if (!data.file_path.startsWith(`${data.incident_id}/`)) {
      throw new Error("File path does not belong to this incident");
    }
    const sb = context.supabase as any;
    const { data: row, error } = await sb
      .from("safety_incident_attachments")
      .insert({
        incident_id: data.incident_id,
        file_path: data.file_path,
        file_name: data.file_name,
        mime_type: data.mime_type ?? null,
        size_bytes: data.size_bytes ?? null,
        description: data.description ?? null,
        uploaded_by: context.userId,
      })
      .select()
      .single();
    if (error) throw error;
    return { row };
  });

const deleteAttachmentSchema = z.object({ id: z.string().uuid() });

export const deleteIncidentAttachment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => deleteAttachmentSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    const { data: row, error: fErr } = await sb
      .from("safety_incident_attachments")
      .select("id, file_path")
      .eq("id", data.id)
      .single();
    if (fErr || !row) throw new Error("Attachment not found");
    // Remove the storage object first, then the metadata row
    const { error: sErr } = await sb.storage.from(BUCKET).remove([row.file_path]);
    if (sErr) throw sErr;
    const { error } = await sb
      .from("safety_incident_attachments")
      .delete()
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

const logExportSchema = z.object({
  format: z.enum(["csv", "xlsx"]),
  view: z.string().trim().max(50),
  search: z.string().trim().max(200).default(""),
  columns: z.array(z.string().max(100)).max(100).default([]),
  row_count: z.number().int().min(0).max(100000),
});

export const logSafetyIncidentExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => logExportSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    const { error } = await sb.from("safety_incident_export_log").insert({
      exported_by: context.userId,
      format: data.format,
      view: data.view,
      search: data.search,
      columns: data.columns,
      row_count: data.row_count,
    });
    if (error) throw error;
    return { ok: true };
  });

const listExportLogSchema = z.object({
  format: z.enum(["csv", "xlsx"]).optional().nullable(),
  from_date: dateStr.optional().nullable(),
  to_date: dateStr.optional().nullable(),
  limit: z.number().int().min(1).max(500).default(200),
});

export const listSafetyIncidentExportLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => listExportLogSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;
    let q = sb
      .from("safety_incident_export_log")
      .select("id, exported_by, exported_at, format, view, search, columns, row_count")
      .order("exported_at", { ascending: false })
      .limit(data.limit);
    if (data.format) q = q.eq("format", data.format);
    if (data.from_date) q = q.gte("exported_at", `${data.from_date}T00:00:00Z`);
    if (data.to_date) q = q.lte("exported_at", `${data.to_date}T23:59:59Z`);
    const { data: rows, error } = await q;
    if (error) throw error;

    // Enrich with exporter display names
    const ids = Array.from(new Set((rows ?? []).map((r: any) => r.exported_by).filter(Boolean)));
    let profileMap: Record<string, string> = {};
    if (ids.length > 0) {
      const { data: profs } = await sb
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", ids);
      profileMap = Object.fromEntries(
        (profs ?? []).map((p: any) => [p.user_id, p.display_name ?? ""]),
      );
    }
    const enriched = (rows ?? []).map((r: any) => ({
      ...r,
      exported_by_name: profileMap[r.exported_by] ?? null,
    }));
    return { rows: enriched };
  });

