import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const eventInput = z.object({
  title: z.string().trim().min(2).max(120),
  tagline: z.string().trim().max(200).optional().nullable(),
  description: z.string().trim().max(4000).optional().nullable(),
  venue_name: z.string().trim().min(2).max(120),
  address: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  starts_at: z.string().min(1),
  ends_at: z.string().optional().nullable(),
  dress_code: z.string().trim().max(120).optional().nullable(),
  theme: z.string().trim().max(120).optional().nullable(),
  capacity: z.number().int().positive().max(10000).optional().nullable(),
  ticket_price_cents: z.number().int().min(0).max(10_000_00).default(0),
  cover_image_url: z.string().url().max(500).optional().nullable(),
  is_private: z.boolean().default(false),
  published: z.boolean().default(true),
  // Venue compliance
  permits_confirmed: z.boolean().default(false),
  permit_details: z.string().trim().max(1000).optional().nullable(),
  insurance_confirmed: z.boolean().default(false),
  insurance_provider: z.string().trim().max(200).optional().nullable(),
  insurance_policy_number: z.string().trim().max(120).optional().nullable(),
  insurance_expires_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  legal_capacity: z.number().int().positive().max(100000).optional().nullable(),
  capacity_confirmed: z.boolean().default(false),
  compliance_notes: z.string().trim().max(2000).optional().nullable(),
  waiver_text: z.string().trim().min(20, "Waiver must be at least 20 characters").max(20000).optional(),
}).superRefine((v, ctx) => {
  if (v.capacity && v.legal_capacity && v.capacity > v.legal_capacity) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["capacity"],
      message: "Event capacity cannot exceed the venue's legal capacity.",
    });
  }
  if (v.published && !(v.permits_confirmed && v.insurance_confirmed && v.capacity_confirmed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["published"],
      message: "Confirm permits, insurance, and capacity before publishing. Save as draft otherwise.",
    });
  }
});

const REQUIRED_DOC_TYPES = ["permit", "insurance", "capacity"] as const;



export const listMyEvents = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("events")
      .select("id, title, starts_at, venue_name, is_private, published, cover_image_url")
      .eq("host_id", context.userId)
      .order("starts_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const getMyEvent = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: event, error } = await context.supabase
      .from("events")
      .select("*")
      .eq("id", data.id)
      .eq("host_id", context.userId)
      .maybeSingle();
    if (error) throw error;
    if (!event) throw new Error("Not found");
    const { data: codes } = await context.supabase
      .from("event_access_codes")
      .select("*")
      .eq("event_id", data.id)
      .order("created_at");
    const { data: rsvpsRaw } = await context.supabase
      .from("rsvps")
      .select("id, user_id, guest_count, ticket_code, status, created_at")
      .eq("event_id", data.id)
      .order("created_at", { ascending: false });
    const userIds = (rsvpsRaw ?? []).map((r) => r.user_id);
    const { data: profs } = userIds.length
      ? await context.supabase.from("profiles").select("user_id, display_name").in("user_id", userIds)
      : { data: [] as { user_id: string; display_name: string | null }[] };
    const nameByUser = new Map((profs ?? []).map((p) => [p.user_id, p.display_name]));
    const rsvps = (rsvpsRaw ?? []).map((r) => ({ ...r, display_name: nameByUser.get(r.user_id) ?? null }));
    return { event, codes: codes ?? [], rsvps };
  });

export const createEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: z.infer<typeof eventInput>) => eventInput.parse(data))
  .handler(async ({ data, context }) => {
    // New events always start as drafts — required compliance docs are uploaded
    // on the edit page before publishing.
    const { data: row, error } = await context.supabase
      .from("events")
      .insert({ ...data, published: false, host_id: context.userId })
      .select("id")
      .single();
    if (error) throw error;
    return row;
  });


export const updateEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string } & z.infer<typeof eventInput>) =>
    z.object({ id: z.string().uuid() }).and(eventInput).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { id, ...update } = data;
    if (update.published) {
      const { data: docs, error: docErr } = await context.supabase
        .from("event_documents")
        .select("doc_type")
        .eq("event_id", id);
      if (docErr) throw docErr;
      const have = new Set((docs ?? []).map((d) => d.doc_type));
      const missing = REQUIRED_DOC_TYPES.filter((t) => !have.has(t));
      if (missing.length) {
        throw new Error(
          `Upload required documents before publishing: ${missing.join(", ")}. Save as draft otherwise.`,
        );
      }
    }
    const { error } = await context.supabase
      .from("events")
      .update(update)
      .eq("id", id)
      .eq("host_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });


export const deleteEvent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("events")
      .delete()
      .eq("id", data.id)
      .eq("host_id", context.userId);
    if (error) throw error;
    return { ok: true };
  });

export const addAccessCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string; code: string; note?: string }) =>
    z.object({
      event_id: z.string().uuid(),
      code: z.string().trim().min(3).max(64),
      note: z.string().trim().max(120).optional(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Verify ownership
    const { data: owned } = await context.supabase
      .from("events")
      .select("id")
      .eq("id", data.event_id)
      .eq("host_id", context.userId)
      .maybeSingle();
    if (!owned) throw new Error("Forbidden");
    const { error } = await context.supabase
      .from("event_access_codes")
      .insert({ event_id: data.event_id, code: data.code, note: data.note ?? null });
    if (error) throw error;
    return { ok: true };
  });

export const deleteAccessCode = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    // RLS on event_access_codes checks event ownership
    const { error } = await context.supabase.from("event_access_codes").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

const markUsedSchema = z.object({
  used: z.boolean(),
  used_by_name: z.string().trim().max(120).optional(),
}).superRefine((v, ctx) => {
  if (v.used && !v.used_by_name) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["used_by_name"], message: "Guest name is required when marking a code as used" });
  }
});

export const setAccessCodeUsed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; used: boolean; used_by_name?: string }) =>
    z.object({ id: z.string().uuid() }).and(markUsedSchema).parse(data),
  )
  .handler(async ({ data, context }) => {
    const patch = data.used
      ? { used_at: new Date().toISOString(), used_by_name: data.used_by_name!.trim() }
      : { used_at: null, used_by_name: null };
    const { error } = await context.supabase
      .from("event_access_codes").update(patch).eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const bulkSetAccessCodesUsed = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { ids: string[]; used: boolean; used_by_name?: string }) =>
    z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).and(markUsedSchema).parse(data),
  )
  .handler(async ({ data, context }) => {
    const patch = data.used
      ? { used_at: new Date().toISOString(), used_by_name: data.used_by_name!.trim() }
      : { used_at: null, used_by_name: null };
    const { error, count } = await context.supabase
      .from("event_access_codes").update(patch, { count: "exact" }).in("id", data.ids);
    if (error) throw error;
    return { ok: true, count: count ?? data.ids.length };
  });

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randCode(prefix: string, len: number) {
  let s = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return `${prefix}-${s}`;
}

export const updateAccessCodeGuestName = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string; used_by_name: string }) =>
    z.object({
      id: z.string().uuid(),
      used_by_name: z.string().trim().min(1, "Guest name is required").max(120),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    // Only allow editing the name on codes that are already marked used.
    const { data: row, error: readErr } = await context.supabase
      .from("event_access_codes")
      .select("id, used_at")
      .eq("id", data.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) throw new Error("Not found");
    if (!row.used_at) throw new Error("Code is not marked as used");
    const { error } = await context.supabase
      .from("event_access_codes")
      .update({ used_by_name: data.used_by_name.trim() })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const bulkAddAccessCodes = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string; quantity: number; prefix?: string; note?: string; length?: number }) =>
    z.object({
      event_id: z.string().uuid(),
      quantity: z.number().int().min(1).max(200),
      prefix: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9]+$/).default("PINK"),
      note: z.string().trim().max(120).optional(),
      length: z.number().int().min(4).max(12).default(6),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: owned } = await context.supabase
      .from("events").select("id").eq("id", data.event_id).eq("host_id", context.userId).maybeSingle();
    if (!owned) throw new Error("Forbidden");
    const prefix = data.prefix.toUpperCase();
    const seen = new Set<string>();
    const rows = Array.from({ length: data.quantity }, () => {
      let code = randCode(prefix, data.length);
      while (seen.has(code)) code = randCode(prefix, data.length);
      seen.add(code);
      return { event_id: data.event_id, code, note: data.note ?? null };
    });
    const { data: inserted, error } = await context.supabase
      .from("event_access_codes").insert(rows).select("id, code");
    if (error) throw error;
    return { ok: true, codes: inserted ?? [] };
  });

// -------- Event compliance documents --------

const docTypeSchema = z.enum(["permit", "insurance", "capacity", "other"]);

async function assertOwnsEvent(supabase: any, userId: string, eventId: string) {
  const { data, error } = await supabase
    .from("events").select("id").eq("id", eventId).eq("host_id", userId).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Forbidden");
}

export const listEventDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string }) =>
    z.object({ event_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOwnsEvent(context.supabase, context.userId, data.event_id);
    const { data: docs, error } = await context.supabase
      .from("event_documents")
      .select("id, doc_type, file_path, file_name, content_type, size_bytes, uploaded_at")
      .eq("event_id", data.event_id)
      .order("uploaded_at", { ascending: false });
    if (error) throw error;
    return docs ?? [];
  });

export const registerEventDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    event_id: string; doc_type: z.infer<typeof docTypeSchema>;
    file_path: string; file_name: string; content_type?: string; size_bytes?: number;
  }) => z.object({
    event_id: z.string().uuid(),
    doc_type: docTypeSchema,
    file_path: z.string().min(1).max(500),
    file_name: z.string().trim().min(1).max(200),
    content_type: z.string().max(120).optional(),
    size_bytes: z.number().int().min(0).max(50 * 1024 * 1024).optional(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOwnsEvent(context.supabase, context.userId, data.event_id);
    if (!data.file_path.startsWith(`${data.event_id}/`)) {
      throw new Error("Invalid file path");
    }
    const { data: row, error } = await context.supabase
      .from("event_documents")
      .insert({
        event_id: data.event_id,
        doc_type: data.doc_type,
        file_path: data.file_path,
        file_name: data.file_name,
        content_type: data.content_type ?? null,
        size_bytes: data.size_bytes ?? null,
        uploaded_by: context.userId,
      })
      .select("id, doc_type, file_path, file_name, content_type, size_bytes, uploaded_at")
      .single();
    if (error) throw error;
    return row;
  });

export const deleteEventDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: doc, error: readErr } = await context.supabase
      .from("event_documents").select("id, event_id, file_path").eq("id", data.id).maybeSingle();
    if (readErr) throw readErr;
    if (!doc) throw new Error("Not found");
    await assertOwnsEvent(context.supabase, context.userId, doc.event_id);
    const { error: rmErr } = await context.supabase.storage
      .from("event-documents").remove([doc.file_path]);
    if (rmErr) throw rmErr;
    const { error } = await context.supabase.from("event_documents").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const signEventDocumentUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { id: string }) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: doc, error } = await context.supabase
      .from("event_documents").select("event_id, file_path, file_name").eq("id", data.id).maybeSingle();
    if (error) throw error;
    if (!doc) throw new Error("Not found");
    await assertOwnsEvent(context.supabase, context.userId, doc.event_id);
    const { data: signed, error: sErr } = await context.supabase.storage
      .from("event-documents").createSignedUrl(doc.file_path, 300, { download: doc.file_name });
    if (sErr) throw sErr;
    return { url: signed.signedUrl };
  });

export const listEventWaivers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { eventId: string }) =>
    z.object({ eventId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsEvent(context.supabase, context.userId, data.eventId);

    const { data: event, error: eErr } = await context.supabase
      .from("events")
      .select("id, title, waiver_text")
      .eq("id", data.eventId)
      .maybeSingle();
    if (eErr) throw eErr;
    if (!event) throw new Error("Not found");

    const { data: rows, error } = await context.supabase
      .from("rsvps")
      .select(
        "id, user_id, ticket_code, status, guest_count, created_at, waiver_signature, waiver_accepted_at, waiver_text_hash",
      )
      .eq("event_id", data.eventId)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const userIds = (rows ?? []).map((r) => r.user_id);
    const { data: profs } = userIds.length
      ? await context.supabase
          .from("profiles")
          .select("user_id, display_name")
          .in("user_id", userIds)
      : { data: [] as { user_id: string; display_name: string | null }[] };
    const nameByUser = new Map((profs ?? []).map((p) => [p.user_id, p.display_name]));

    // Compute the current waiver text hash so we can flag out-of-date signatures.
    const waiverText = (event.waiver_text ?? "").trim();
    const enc = new TextEncoder().encode(waiverText);
    const digest = await crypto.subtle.digest("SHA-256", enc);
    const currentHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const rsvps = (rows ?? []).map((r) => {
      const accepted = Boolean(r.waiver_signature && r.waiver_accepted_at);
      const hashCurrent =
        accepted && r.waiver_text_hash ? r.waiver_text_hash === currentHash : false;
      return {
        ...r,
        display_name: nameByUser.get(r.user_id) ?? null,
        waiver_accepted: accepted,
        waiver_hash_current: hashCurrent,
      };
    });

    const total = rsvps.length;
    const acceptedCount = rsvps.filter((r) => r.waiver_accepted).length;
    const staleCount = rsvps.filter(
      (r) => r.waiver_accepted && !r.waiver_hash_current,
    ).length;

    return {
      event: { id: event.id, title: event.title },
      currentHash,
      rsvps,
      summary: { total, accepted: acceptedCount, missing: total - acceptedCount, stale: staleCount },
    };
  });

