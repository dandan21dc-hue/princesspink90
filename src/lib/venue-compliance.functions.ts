import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import {
  VENUE_COMPLIANCE_ALLOWED_MIME,
  VENUE_COMPLIANCE_MAX_BYTES,
  validateComplianceFile,
  validateExpiryDate,
} from "@/lib/venue-compliance-validation";

const BUCKET = "venue-compliance";
const ALLOWED_MIME_SET = new Set<string>(VENUE_COMPLIANCE_ALLOWED_MIME);

// Sniff the first bytes of an upload to confirm the file's actual type.
// Returns the canonical MIME string, or null when nothing matches.
function detectFileKind(bytes: Uint8Array): string | null {
  if (bytes.length >= 4 &&
      bytes[0] === 0x25 && bytes[1] === 0x50 &&
      bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf"; // %PDF
  if (bytes.length >= 8 &&
      bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 &&
      bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50)
    return "image/webp";
  return null;
}

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

// Best-effort audit writer. Never throws — a failed audit write must not
// mask or roll back the real action (which has its own error handling).
async function writeAudit(
  supabase: any,
  actorId: string,
  entry: {
    action: "uploaded" | "updated" | "deleted" | "summary_generated";
    document_id?: string | null;
    document_title?: string | null;
    document_kind?: string | null;
    details?: Record<string, unknown>;
  },
) {
  try {
    await supabase.from("venue_compliance_audit_log").insert({
      action: entry.action,
      document_id: entry.document_id ?? null,
      document_title: entry.document_title ?? null,
      document_kind: entry.document_kind ?? null,
      actor_id: actorId,
      details: entry.details ?? {},
    });
  } catch (e) {
    console.error("[venue-compliance] audit write failed", e);
  }
}

const kindEnum = z.enum(["public_liability_insurance", "event_permit", "other"]);

export const listVenueComplianceDocs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data, error } = await context.supabase
      .from("venue_compliance_documents")
      .select(
        "id, kind, title, issuer, reference_number, issued_on, expires_on, notes, file_path, file_name, file_size, file_mime_type, created_at",
      )
      .order("kind", { ascending: true })
      .order("expires_on", { ascending: true, nullsFirst: false });
    if (error) throw error;
    return { rows: data ?? [] };
  });

const createSchema = z.object({
  kind: kindEnum,
  title: z.string().trim().min(1).max(200),
  issuer: z.string().trim().max(200).optional().nullable(),
  reference_number: z.string().trim().max(200).optional().nullable(),
  issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  file_name: z.string().trim().min(1).max(255),
  file_mime_type: z
    .string()
    .trim()
    .max(200)
    .optional()
    .nullable()
    .refine(
      (v) => !v || ALLOWED_MIME_SET.has(v.toLowerCase()),
      "Only PDF, PNG, JPG, or WEBP files are accepted.",
    ),
  file_size: z
    .number()
    .int()
    .min(1, "The selected file is empty.")
    .max(VENUE_COMPLIANCE_MAX_BYTES, "File exceeds the 15 MB limit.")
    .optional()
    .nullable(),
  // base64 payload of the file bytes
  file_base64: z.string().min(1),
});

export const uploadVenueComplianceDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => createSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    // Re-run the shared validators server-side.
    const nameCheck = validateComplianceFile({
      name: data.file_name,
      size: data.file_size ?? 0,
      type: data.file_mime_type ?? null,
    });
    if (!nameCheck.ok) throw new Error(nameCheck.error);

    const expiryCheck = validateExpiryDate(data.expires_on);
    if (!expiryCheck.ok) throw new Error(expiryCheck.error);

    // decode base64 -> bytes
    const bin = atob(data.file_base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (bytes.byteLength > VENUE_COMPLIANCE_MAX_BYTES) {
      throw new Error("File exceeds the 15 MB limit.");
    }
    if (bytes.byteLength === 0) {
      throw new Error("The uploaded file is empty.");
    }

    // Magic-byte sniff to ensure the bytes actually match the claimed type.
    const detected = detectFileKind(bytes);
    if (!detected) {
      throw new Error(
        "Only PDF, PNG, JPG, or WEBP files can be uploaded as compliance documents.",
      );
    }
    const claimed = (data.file_mime_type ?? "").toLowerCase();
    if (claimed && claimed !== detected) {
      throw new Error(
        `File contents (${detected}) do not match the declared type (${claimed}).`,
      );
    }

    const safeName = data.file_name.replace(/[^\w.\-]+/g, "_").slice(-120);
    const path = `${data.kind}/${crypto.randomUUID()}-${safeName}`;

    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const { error: upErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .upload(path, bytes, {
        contentType: data.file_mime_type ?? detected,
        upsert: false,
      });
    if (upErr) throw upErr;


    const { data: row, error } = await context.supabase
      .from("venue_compliance_documents")
      .insert({
        kind: data.kind,
        title: data.title,
        issuer: data.issuer ?? null,
        reference_number: data.reference_number ?? null,
        issued_on: data.issued_on ?? null,
        expires_on: data.expires_on ?? null,
        notes: data.notes ?? null,
        file_path: path,
        file_name: safeName,
        file_size: bytes.byteLength,
        file_mime_type: data.file_mime_type ?? null,
        uploaded_by: context.userId,
      })
      .select()
      .single();
    if (error) {
      // best-effort cleanup of the uploaded file
      await supabaseAdmin.storage.from(BUCKET).remove([path]);
      throw error;
    }

    await writeAudit(context.supabase, context.userId, {
      action: "uploaded",
      document_id: row.id,
      document_title: row.title,
      document_kind: row.kind,
      details: {
        file_name: safeName,
        file_size: bytes.byteLength,
        file_mime_type: data.file_mime_type ?? null,
        issuer: data.issuer ?? null,
        reference_number: data.reference_number ?? null,
        issued_on: data.issued_on ?? null,
        expires_on: data.expires_on ?? null,
      },
    });

    return { row };
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  kind: kindEnum,
  issuer: z.string().trim().max(200).optional().nullable(),
  reference_number: z.string().trim().max(200).optional().nullable(),
  issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
});

export const updateVenueComplianceDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => updateSchema.parse(data))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: before, error: bErr } = await context.supabase
      .from("venue_compliance_documents")
      .select("kind, title, issuer, reference_number, issued_on, expires_on, notes")
      .eq("id", data.id)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!before) throw new Error("Document not found");

    const patch = {
      kind: data.kind,
      title: data.title,
      issuer: data.issuer ?? null,
      reference_number: data.reference_number ?? null,
      issued_on: data.issued_on ?? null,
      expires_on: data.expires_on ?? null,
      notes: data.notes ?? null,
    };

    const { data: row, error } = await context.supabase
      .from("venue_compliance_documents")
      .update(patch)
      .eq("id", data.id)
      .select()
      .single();
    if (error) throw error;

    // Record a diff of changed fields only, so the audit trail is readable.
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const key of Object.keys(patch) as Array<keyof typeof patch>) {
      const from = (before as any)[key] ?? null;
      const to = (patch as any)[key] ?? null;
      if (from !== to) changed[key] = { from, to };
    }

    if (Object.keys(changed).length > 0) {
      await writeAudit(context.supabase, context.userId, {
        action: "updated",
        document_id: row.id,
        document_title: row.title,
        document_kind: row.kind,
        details: { changes: changed },
      });
    }

    return { row };
  });

export const getVenueComplianceDownloadUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("venue_compliance_documents")
      .select("file_path, file_name")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw new Error("Document not found");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from(BUCKET)
      .createSignedUrl(row.file_path, 60 * 10, { download: row.file_name });
    if (sErr) throw sErr;
    return { url: signed.signedUrl };
  });

export const deleteVenueComplianceDoc = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ id: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: row, error } = await context.supabase
      .from("venue_compliance_documents")
      .select("file_path, title, kind, file_name")
      .eq("id", data.id)
      .maybeSingle();
    if (error) throw error;
    if (!row) return { ok: true };
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.storage.from(BUCKET).remove([row.file_path]);
    const { error: dErr } = await context.supabase
      .from("venue_compliance_documents")
      .delete()
      .eq("id", data.id);
    if (dErr) throw dErr;

    await writeAudit(context.supabase, context.userId, {
      action: "deleted",
      document_id: data.id,
      document_title: row.title,
      document_kind: row.kind,
      details: { file_name: row.file_name, file_path: row.file_path },
    });

    return { ok: true };
  });

export const listVenueComplianceAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: rows, error } = await context.supabase
      .from("venue_compliance_audit_log")
      .select("id, action, document_id, document_title, document_kind, actor_id, details, created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    // Resolve actor display names / emails via profiles (public) and Auth admin.
    const actorIds = Array.from(new Set((rows ?? []).map((r: any) => r.actor_id)));
    const actorMap: Record<string, { name: string | null; email: string | null }> = {};

    if (actorIds.length > 0) {
      const { data: profs } = await context.supabase
        .from("profiles")
        .select("user_id, display_name")
        .in("user_id", actorIds);
      for (const p of profs ?? []) {
        actorMap[(p as any).user_id] = {
          name: (p as any).display_name ?? null,
          email: null,
        };
      }

      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      for (const id of actorIds) {
        try {
          const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
          const email = u?.user?.email ?? null;
          actorMap[id] = { name: actorMap[id]?.name ?? null, email };
        } catch {
          // ignore; actor may have been deleted
        }
      }
    }

    return {
      rows: (rows ?? []).map((r: any) => ({
        ...r,
        actor_name: actorMap[r.actor_id]?.name ?? null,
        actor_email: actorMap[r.actor_id]?.email ?? null,
      })),
    };
  });

// -------- Compliance summary PDF --------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + chunk)),
    );
  }
  return btoa(bin);
}

const KIND_LABEL: Record<string, string> = {
  public_liability_insurance: "Public liability insurance",
  event_permit: "Event permit",
  other: "Other compliance document",
};

export const generateComplianceSummaryPdf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        venue_name: z.string().trim().max(200).optional().default(""),
        event_date: z.string().trim().max(200).optional().default(""),
        recipient: z.string().trim().max(200).optional().default(""),
      })
      .parse(data ?? {}),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);

    const { data: rows, error } = await context.supabase
      .from("venue_compliance_documents")
      .select(
        "id, kind, title, issuer, reference_number, issued_on, expires_on, notes",
      )
      .order("kind", { ascending: true })
      .order("expires_on", { ascending: true, nullsFirst: false });
    if (error) throw error;

    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
    const pdf = await PDFDocument.create();
    const body = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

    const pageWidth = 595.28;
    const pageHeight = 841.89;
    const margin = 56;
    let page = pdf.addPage([pageWidth, pageHeight]);
    let cursor = pageHeight - margin;

    const ink = rgb(0.08, 0.08, 0.12);
    const dim = rgb(0.42, 0.42, 0.48);
    const accent = rgb(0.85, 0.15, 0.45);

    const wrap = (text: string, font: any, size: number, maxWidth: number) => {
      const out: string[] = [];
      for (const raw of text.split(/\n/)) {
        const words = raw.split(/\s+/);
        let line = "";
        for (const w of words) {
          const trial = line ? line + " " + w : w;
          if (font.widthOfTextAtSize(trial, size) > maxWidth && line) {
            out.push(line);
            line = w;
          } else {
            line = trial;
          }
        }
        out.push(line);
      }
      return out;
    };

    const draw = (
      text: string,
      opts: { font?: any; size?: number; color?: any; lineHeight?: number } = {},
    ) => {
      const f = opts.font ?? body;
      const s = opts.size ?? 11;
      const c = opts.color ?? ink;
      const lh = s * (opts.lineHeight ?? 1.35);
      for (const line of wrap(text, f, s, pageWidth - margin * 2)) {
        if (cursor < margin + lh) {
          page = pdf.addPage([pageWidth, pageHeight]);
          cursor = pageHeight - margin;
        }
        page.drawText(line, { x: margin, y: cursor - s, size: s, font: f, color: c });
        cursor -= lh;
      }
    };

    const hr = () => {
      cursor -= 6;
      page.drawLine({
        start: { x: margin, y: cursor },
        end: { x: pageWidth - margin, y: cursor },
        thickness: 0.5,
        color: rgb(0.85, 0.85, 0.9),
      });
      cursor -= 10;
    };

    // Header
    draw("AFTERDARK", { font: bold, size: 10, color: accent });
    cursor -= 2;
    draw("Venue compliance summary", { font: bold, size: 18 });
    draw(
      "Prepared for venue booking review",
      { font: italic, size: 10, color: dim },
    );
    hr();

    const today = new Date().toLocaleDateString(undefined, {
      dateStyle: "long",
    });
    const field = (label: string, value: string) => {
      draw(label, { font: bold, size: 9, color: dim });
      cursor += 4;
      draw(value || "—", { font: body, size: 11 });
      cursor -= 2;
    };
    field("Prepared on", today);
    if (data.recipient) field("Recipient", data.recipient);
    if (data.venue_name) field("Venue", data.venue_name);
    if (data.event_date) field("Proposed date", data.event_date);
    hr();

    if (!rows || rows.length === 0) {
      draw("No compliance documents on file.", {
        font: italic,
        size: 11,
        color: dim,
      });
    } else {
      // Group by kind
      const grouped: Record<string, typeof rows> = {};
      for (const r of rows) {
        (grouped[r.kind] ||= [] as any).push(r);
      }
      for (const kind of Object.keys(grouped)) {
        draw(KIND_LABEL[kind] ?? kind, {
          font: bold,
          size: 13,
          color: accent,
        });
        cursor -= 2;
        for (const r of grouped[kind]) {
          draw(r.title, { font: bold, size: 11 });
          const parts: string[] = [];
          if (r.issuer) parts.push(`Issuer: ${r.issuer}`);
          if (r.reference_number) parts.push(`Ref: ${r.reference_number}`);
          if (r.issued_on) parts.push(`Issued: ${r.issued_on}`);
          if (r.expires_on) {
            const exp = new Date(r.expires_on);
            const expired = exp.getTime() < Date.now();
            parts.push(
              `${expired ? "Expired" : "Expires"}: ${r.expires_on}`,
            );
          }
          if (parts.length) {
            draw(parts.join("  ·  "), { font: body, size: 10, color: dim });
          }
          if (r.notes) {
            draw(r.notes, { font: italic, size: 10, color: ink });
          }
          cursor -= 6;
        }
        hr();
      }
    }

    draw(
      "This summary is a snapshot of current compliance records. Original certificates are available on request from the operator.",
      { font: italic, size: 9, color: dim },
    );

    const bytes = await pdf.save();
    const stamp = new Date().toISOString().slice(0, 10);
    const slug =
      (data.venue_name || "venue")
        .toLowerCase()
        .replace(/[^\w\-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 40) || "venue";
    const filename = `compliance-summary-${slug}-${stamp}.pdf`;

    await writeAudit(context.supabase, context.userId, {
      action: "summary_generated",
      document_id: null,
      document_title: filename,
      details: {
        filename,
        venue_name: data.venue_name || null,
        event_date: data.event_date || null,
        recipient: data.recipient || null,
        document_count: rows?.length ?? 0,
        document_ids: (rows ?? []).map((r: any) => r.id),
        byte_size: bytes.byteLength,
      },
    });

    return {
      base64: bytesToBase64(bytes),
      filename,
      contentType: "application/pdf",
    };
  });
