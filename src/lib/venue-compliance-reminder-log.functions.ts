import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

const filterSchema = z.object({
  status: z.enum(["all", "queued", "sent", "failed"]).default("all"),
  kind: z
    .enum(["all", "public_liability_insurance", "event_permit", "other"])
    .default("all"),
  reminder_type: z.string().max(50).default("all"),
  since_days: z.number().int().min(1).max(365).nullable().default(30),
  document_id: z.string().uuid().nullable().default(null),
  recipient: z.string().max(320).nullable().default(null),
  limit: z.number().int().min(1).max(1000).default(500),
});

export type VenueComplianceReminderRow = {
  id: string;
  document_id: string;
  kind: string;
  reminder_type: string;
  expires_on: string;
  recipients: unknown;
  channels: unknown;
  status: string;
  error_message: string | null;
  idempotency_key: string;
  created_at: string;
  document?: {
    id: string;
    title: string | null;
    venue_name: string | null;
  } | null;
};

function toRecipientList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string") return v;
        if (v && typeof v === "object") {
          const obj = v as Record<string, unknown>;
          return (
            (obj.email as string | undefined) ??
            (obj.address as string | undefined) ??
            (obj.to as string | undefined) ??
            ""
          );
        }
        return "";
      })
      .filter(Boolean);
  }
  if (value && typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((v) => (typeof v === "string" ? v : ""))
      .filter(Boolean);
  }
  return [];
}

export const listVenueComplianceReminderLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => filterSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const sb = context.supabase as any;

    let q = sb
      .from("venue_compliance_reminder_log")
      .select(
        `id, document_id, kind, reminder_type, expires_on, recipients, channels, status, error_message, idempotency_key, created_at, attempt_count, max_attempts, last_attempt_at, next_retry_at,
         document:venue_compliance_documents(id, title, venue_name)`,
      )
      .order("created_at", { ascending: false })
      .limit(data.limit);

    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.kind !== "all") q = q.eq("kind", data.kind);
    if (data.reminder_type !== "all")
      q = q.eq("reminder_type", data.reminder_type);
    if (data.document_id) q = q.eq("document_id", data.document_id);
    if (data.since_days) {
      const since = new Date(
        Date.now() - data.since_days * 86400_000,
      ).toISOString();
      q = q.gte("created_at", since);
    }

    const { data: rows, error } = await q;
    if (error) throw error;

    let filtered = (rows ?? []) as VenueComplianceReminderRow[];
    const recipientQuery = data.recipient?.trim().toLowerCase();
    if (recipientQuery) {
      filtered = filtered.filter((r) =>
        toRecipientList(r.recipients).some((e) =>
          e.toLowerCase().includes(recipientQuery),
        ),
      );
    }

    const summary = {
      total: filtered.length,
      queued: 0,
      sent: 0,
      failed: 0,
      last_attempt_at: null as string | null,
      types: new Set<string>(),
    };
    for (const r of filtered) {
      if (r.status === "queued") summary.queued++;
      else if (r.status === "sent") summary.sent++;
      else if (r.status === "failed") summary.failed++;
      if (!summary.last_attempt_at || r.created_at > summary.last_attempt_at)
        summary.last_attempt_at = r.created_at;
      if (r.reminder_type) summary.types.add(r.reminder_type);
    }

    return {
      rows: filtered.map((r) => ({
        id: r.id,
        document_id: r.document_id,
        kind: r.kind,
        reminder_type: r.reminder_type,
        expires_on: r.expires_on,
        channels: Array.isArray(r.channels) ? (r.channels as string[]) : [],
        status: r.status,
        error_message: r.error_message,
        idempotency_key: r.idempotency_key,
        created_at: r.created_at,
        document: r.document ?? null,
        recipient_list: toRecipientList(r.recipients),
      })),
      summary: {
        total: summary.total,
        queued: summary.queued,
        sent: summary.sent,
        failed: summary.failed,
        last_attempt_at: summary.last_attempt_at,
        reminder_types: Array.from(summary.types).sort(),
      },
    };
  });
