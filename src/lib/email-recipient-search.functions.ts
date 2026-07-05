import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { maskEmail } from "@/lib/mask-email";

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw error;
  if (!data) throw new Error("Admin access required");
}

const searchSchema = z.object({
  query: z.string().trim().min(1).max(320),
  limit: z.number().int().min(1).max(200).default(100),
});

export type EmailRecipientSearchRow = {
  id: string;
  message_id: string | null;
  template_name: string | null;
  recipient_masked: string;
  status: string;
  error_message: string | null;
  resend_message_id: string | null;
  suppressed: boolean;
  suppressed_reason: string | null;
  created_at: string;
};

export const searchEmailByRecipient = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => searchSchema.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<{
    rows: EmailRecipientSearchRow[];
    total_matches: number;
    unique_recipients: number;
  }> => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const sb = supabaseAdmin as any;

    const { data: raw, error } = await sb
      .from("email_send_log")
      .select(
        "id, message_id, template_name, recipient_email, status, error_message, metadata, created_at",
      )
      .ilike("recipient_email", `%${data.query}%`)
      .order("created_at", { ascending: false })
      .limit(data.limit * 3);
    if (error) throw error;

    // Dedupe by message_id, keep newest
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const r of raw ?? []) {
      const key = r.message_id ?? `no-msg:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }
    const trimmed = deduped.slice(0, data.limit);

    // Look up suppression status for the distinct recipients in the result set.
    const distinctRecipients = Array.from(
      new Set(trimmed.map((r) => r.recipient_email).filter(Boolean)),
    );
    const suppressionMap = new Map<string, string | null>();
    if (distinctRecipients.length > 0) {
      const { data: suppressed, error: supErr } = await sb
        .from("suppressed_emails")
        .select("email, reason")
        .in("email", distinctRecipients);
      if (supErr) throw supErr;
      for (const s of suppressed ?? []) {
        suppressionMap.set(String(s.email).toLowerCase(), s.reason ?? null);
      }
    }

    const rows: EmailRecipientSearchRow[] = trimmed.map((r) => {
      const email = String(r.recipient_email ?? "").toLowerCase();
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const resendId =
        (typeof meta.resend_id === "string" && meta.resend_id) ||
        (typeof meta.resend_message_id === "string" &&
          meta.resend_message_id) ||
        (typeof meta.provider_id === "string" && meta.provider_id) ||
        null;
      return {
        id: r.id,
        message_id: r.message_id,
        template_name: r.template_name,
        recipient_masked: maskEmail(r.recipient_email),
        status: r.status,
        error_message: r.error_message,
        resend_message_id: resendId,
        suppressed: suppressionMap.has(email),
        suppressed_reason: suppressionMap.get(email) ?? null,
        created_at: r.created_at,
      };
    });

    return {
      rows,
      total_matches: deduped.length,
      unique_recipients: distinctRecipients.length,
    };
  });
