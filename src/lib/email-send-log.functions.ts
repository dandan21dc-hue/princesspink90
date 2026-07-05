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
  status: z
    .enum([
      "all",
      "pending",
      "sent",
      "suppressed",
      "failed",
      "bounced",
      "complained",
      "dlq",
    ])
    .default("all"),
  template_name: z.string().max(120).default("all"),
  since_days: z.number().int().min(1).max(365).nullable().default(30),
  recipient: z.string().max(320).nullable().default(null),
  limit: z.number().int().min(1).max(1000).default(500),
});

export const listEmailSendLog = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => filterSchema.parse(data ?? {}))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { supabaseAdmin } = await import(
      "@/integrations/supabase/client.server"
    );
    const sb = supabaseAdmin as any;

    // Pull a wider set then dedupe by message_id (latest row per message).
    const fetchLimit = Math.min(data.limit * 3, 3000);
    let q = sb
      .from("email_send_log")
      .select(
        "id, message_id, template_name, recipient_email, status, error_message, metadata, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(fetchLimit);

    if (data.template_name !== "all")
      q = q.eq("template_name", data.template_name);
    if (data.recipient) q = q.ilike("recipient_email", `%${data.recipient}%`);
    if (data.since_days) {
      const since = new Date(
        Date.now() - data.since_days * 86400_000,
      ).toISOString();
      q = q.gte("created_at", since);
    }

    const { data: raw, error } = await q;
    if (error) throw error;

    // Deduplicate by message_id, keep newest (already ordered desc).
    const seen = new Set<string>();
    const deduped: any[] = [];
    for (const r of raw ?? []) {
      const key = r.message_id ?? `no-msg:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(r);
    }

    const filtered =
      data.status === "all"
        ? deduped
        : deduped.filter((r) => r.status === data.status);
    const rows = filtered.slice(0, data.limit);

    const templateSet = new Set<string>();
    const summary = {
      total: 0,
      sent: 0,
      failed: 0,
      suppressed: 0,
      pending: 0,
      other: 0,
      last_sent_at: null as string | null,
    };
    for (const r of deduped) {
      summary.total++;
      if (r.template_name) templateSet.add(r.template_name);
      switch (r.status) {
        case "sent":
          summary.sent++;
          if (!summary.last_sent_at || r.created_at > summary.last_sent_at)
            summary.last_sent_at = r.created_at;
          break;
        case "failed":
        case "dlq":
        case "bounced":
        case "complained":
          summary.failed++;
          break;
        case "suppressed":
          summary.suppressed++;
          break;
        case "pending":
          summary.pending++;
          break;
        default:
          summary.other++;
      }
    }

    return {
      rows,
      summary: {
        ...summary,
        templates: Array.from(templateSet).sort(),
        returned: rows.length,
      },
    };
  });
