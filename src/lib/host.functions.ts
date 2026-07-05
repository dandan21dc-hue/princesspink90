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

export const getCurrentPolicyVersion = createServerFn({ method: "GET" })
  .handler(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb
      .from("compliance_policy_versions")
      .select("id, version, effective_at, summary, body")
      .eq("is_current", true)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

export const listPolicyVersions = createServerFn({ method: "GET" })
  .handler(async () => {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { storage: undefined, persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb
      .from("compliance_policy_versions")
      .select("id, version, effective_at, summary, is_current")
      .order("effective_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

export const listEventDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id: string }) =>
    z.object({ event_id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOwnsEvent(context.supabase, context.userId, data.event_id);
    const { data: docs, error } = await context.supabase
      .from("event_documents")
      .select("id, doc_type, file_path, file_name, content_type, size_bytes, uploaded_at, policy_version_id, policy_version_label")
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
    policy_version_id: string;
  }) => z.object({
    event_id: z.string().uuid(),
    doc_type: docTypeSchema,
    file_path: z.string().min(1).max(500),
    file_name: z.string().trim().min(1).max(200),
    content_type: z.string().max(120).optional(),
    size_bytes: z.number().int().min(0).max(50 * 1024 * 1024).optional(),
    policy_version_id: z.string().uuid(),
  }).parse(data))
  .handler(async ({ data, context }) => {
    await assertOwnsEvent(context.supabase, context.userId, data.event_id);
    if (!data.file_path.startsWith(`${data.event_id}/`)) {
      throw new Error("Invalid file path");
    }
    // Verify the policy version is the currently-active one; otherwise reject.
    const { data: pv, error: pvErr } = await context.supabase
      .from("compliance_policy_versions")
      .select("id, version, is_current")
      .eq("id", data.policy_version_id)
      .maybeSingle();
    if (pvErr) throw pvErr;
    if (!pv) throw new Error("Unknown policy version");
    if (!pv.is_current) {
      throw new Error("Compliance policy has been updated. Review and agree to the current version before uploading.");
    }
    // Require an existing agreement for this host + current policy version.
    // The agreement is recorded when the host checks the agreement box in the UI.
    const { data: agreement, error: agErr } = await context.supabase
      .from("compliance_policy_agreements")
      .select("id")
      .eq("accepted_by_user_id", context.userId)
      .eq("policy_version_id", pv.id)
      .limit(1)
      .maybeSingle();
    if (agErr) throw agErr;
    if (!agreement) {
      throw new Error(
        `You must agree to compliance policy v${pv.version} before uploading documents. Check the agreement box above the upload slots and try again.`,
      );
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
        policy_version_id: pv.id,
        policy_version_label: pv.version,
      })
      .select("id, doc_type, file_path, file_name, content_type, size_bytes, uploaded_at, policy_version_id, policy_version_label")
      .single();
    if (error) throw error;
    return row;
  });

async function recordAgreementRow(
  supabase: any,
  userId: string,
  policyVersionId: string,
  policyVersionLabel: string,
  eventId: string | null,
) {
  const { getRequestHeader } = await import("@tanstack/react-start/server");
  const ua = getRequestHeader("user-agent") ?? null;
  const ip =
    (getRequestHeader("x-forwarded-for") ?? "").split(",")[0]?.trim() ||
    getRequestHeader("cf-connecting-ip") ||
    null;
  // Idempotent — unique index on (user, version, coalesce(event, sentinel)).
  const { error } = await supabase
    .from("compliance_policy_agreements")
    .upsert(
      {
        accepted_by_user_id: userId,
        policy_version_id: policyVersionId,
        policy_version_label: policyVersionLabel,
        event_id: eventId,
        ip_address: ip,
        user_agent: ua,
      },
      { onConflict: "accepted_by_user_id,policy_version_id,event_id", ignoreDuplicates: true },
    );
  // Ignore upsert errors caused by the COALESCE-index conflict target not matching;
  // fall back to a plain insert that swallows duplicate-key errors.
  if (error) {
    const { error: insErr } = await supabase
      .from("compliance_policy_agreements")
      .insert({
        accepted_by_user_id: userId,
        policy_version_id: policyVersionId,
        policy_version_label: policyVersionLabel,
        event_id: eventId,
        ip_address: ip,
        user_agent: ua,
      });
    if (insErr && !String(insErr.message ?? "").toLowerCase().includes("duplicate")) throw insErr;
  }
}

export const recordPolicyAgreement = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { policy_version_id: string; event_id?: string | null }) =>
    z.object({
      policy_version_id: z.string().uuid(),
      event_id: z.string().uuid().optional().nullable(),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const { data: pv, error: pvErr } = await context.supabase
      .from("compliance_policy_versions")
      .select("id, version, is_current")
      .eq("id", data.policy_version_id)
      .maybeSingle();
    if (pvErr) throw pvErr;
    if (!pv) throw new Error("Unknown policy version");
    if (!pv.is_current) {
      throw new Error("This policy version is no longer current.");
    }
    if (data.event_id) {
      await assertOwnsEvent(context.supabase, context.userId, data.event_id);
    }
    await recordAgreementRow(
      context.supabase,
      context.userId,
      pv.id,
      pv.version,
      data.event_id ?? null,
    );
    return { ok: true, policy_version_id: pv.id, policy_version_label: pv.version, accepted_at: new Date().toISOString() };
  });

export const listMyPolicyAgreements = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { event_id?: string | null }) =>
    z.object({ event_id: z.string().uuid().optional().nullable() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    let query = context.supabase
      .from("compliance_policy_agreements")
      .select("id, policy_version_id, policy_version_label, event_id, accepted_at, ip_address, user_agent")
      .eq("accepted_by_user_id", context.userId)
      .order("accepted_at", { ascending: false });
    if (data.event_id) query = query.eq("event_id", data.event_id);
    const { data: rows, error } = await query;
    if (error) throw error;
    return rows ?? [];
  });

export const listMyComplianceDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: docs, error } = await context.supabase
      .from("event_documents")
      .select("id, doc_type, file_name, uploaded_at, policy_version_id, policy_version_label, event_id, events!inner(id, title, host_id)")
      .eq("uploaded_by", context.userId)
      .order("uploaded_at", { ascending: false });
    if (error) throw error;
    return (docs ?? []).map((d: any) => ({
      id: d.id as string,
      doc_type: d.doc_type as string,
      file_name: d.file_name as string,
      uploaded_at: d.uploaded_at as string,
      policy_version_id: (d.policy_version_id as string | null) ?? null,
      policy_version_label: (d.policy_version_label as string | null) ?? null,
      event_id: d.event_id as string,
      event_title: (d.events?.title as string | null) ?? null,
    }));
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

export const listWaiverAudit = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { eventId: string }) =>
    z.object({ eventId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertOwnsEvent(context.supabase, context.userId, data.eventId);

    const { data: rows, error } = await context.supabase
      .from("waiver_audit_log")
      .select("id, user_id, rsvp_id, action, waiver_text_hash, waiver_signature, ip_address, user_agent, created_at")
      .eq("event_id", data.eventId)
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const userIds = Array.from(new Set((rows ?? []).map((r) => r.user_id)));
    const { data: profs } = userIds.length
      ? await context.supabase.from("profiles").select("user_id, display_name").in("user_id", userIds)
      : { data: [] as { user_id: string; display_name: string | null }[] };
    const nameByUser = new Map((profs ?? []).map((p) => [p.user_id, p.display_name]));

    return (rows ?? []).map((r) => ({
      ...r,
      display_name: nameByUser.get(r.user_id) ?? null,
    }));
  });

export const getMyEventsCompliance = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: events, error } = await context.supabase
      .from("events")
      .select("id, title, starts_at, venue_name, published, insurance_expires_on, capacity_confirmed")
      .eq("host_id", context.userId)
      .order("starts_at", { ascending: false });
    if (error) throw error;
    const eventList = events ?? [];
    if (eventList.length === 0) return [];

    const ids = eventList.map((e) => e.id);
    const { data: docs, error: docErr } = await context.supabase
      .from("event_documents")
      .select("event_id, doc_type, file_name, uploaded_at")
      .in("event_id", ids);
    if (docErr) throw docErr;

    const now = Date.now();
    const SOON_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

    return eventList.map((e) => {
      const eventDocs = (docs ?? []).filter((d) => d.event_id === e.id);
      const byType = (t: string) =>
        eventDocs
          .filter((d) => d.doc_type === t)
          .sort((a, b) => (b.uploaded_at ?? "").localeCompare(a.uploaded_at ?? ""))[0] ?? null;

      const permitDoc = byType("permit");
      const insuranceDoc = byType("insurance");
      const capacityDoc = byType("capacity");

      const insExp = e.insurance_expires_on ? new Date(e.insurance_expires_on).getTime() : null;
      let insuranceStatus: "missing" | "expired" | "expiring" | "ok" = "missing";
      if (insuranceDoc) {
        if (insExp != null && insExp < now) insuranceStatus = "expired";
        else if (insExp != null && insExp - now < SOON_MS) insuranceStatus = "expiring";
        else insuranceStatus = "ok";
      }

      const items = {
        permit: {
          status: permitDoc ? "ok" : "missing",
          file_name: permitDoc?.file_name ?? null,
          uploaded_at: permitDoc?.uploaded_at ?? null,
        },
        insurance: {
          status: insuranceStatus,
          file_name: insuranceDoc?.file_name ?? null,
          uploaded_at: insuranceDoc?.uploaded_at ?? null,
          expires_on: e.insurance_expires_on,
        },
        capacity: {
          status: capacityDoc ? (e.capacity_confirmed ? "ok" : "unconfirmed") : "missing",
          file_name: capacityDoc?.file_name ?? null,
          uploaded_at: capacityDoc?.uploaded_at ?? null,
          confirmed: e.capacity_confirmed,
        },
      } as const;

      const ready =
        items.permit.status === "ok" &&
        items.insurance.status === "ok" &&
        items.capacity.status === "ok";

      return {
        id: e.id,
        title: e.title,
        starts_at: e.starts_at,
        venue_name: e.venue_name,
        published: e.published,
        ready,
        items,
      };
    });
  });
