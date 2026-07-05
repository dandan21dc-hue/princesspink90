import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

export type SupportMessageRow = {
  id: string;
  role: "user" | "assistant" | "admin" | "system";
  content: string;
  created_at: string;
  metadata: Record<string, string | number | boolean | null>;
};

export type SupportConversationSummary = {
  id: string;
  escalated: boolean;
  escalated_at: string | null;
  escalation_reason: string | null;
  last_message_at: string;
  messages: SupportMessageRow[];
};

async function getOrCreateConversation(
  supabase: {
    from: (table: string) => {
      select: (
        cols: string,
      ) => {
        eq: (
          col: string,
          val: string,
        ) => { maybeSingle: () => Promise<{ data: unknown; error: unknown }> };
      };
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{ data: unknown; error: unknown }>;
        };
      };
    };
  },
  userId: string,
) {
  const existing = await supabase
    .from("support_conversations")
    .select("id, escalated, escalated_at, escalation_reason, last_message_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (existing.data)
    return existing.data as {
      id: string;
      escalated: boolean;
      escalated_at: string | null;
      escalation_reason: string | null;
      last_message_at: string;
    };
  const created = await supabase
    .from("support_conversations")
    .insert({ user_id: userId })
    .select("id, escalated, escalated_at, escalation_reason, last_message_at")
    .single();
  if (created.error) throw created.error;
  return created.data as {
    id: string;
    escalated: boolean;
    escalated_at: string | null;
    escalation_reason: string | null;
    last_message_at: string;
  };
}

export const getMyConversation = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<SupportConversationSummary> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const conv = await getOrCreateConversation(sb, context.userId);
    const { data: messages, error } = await sb
      .from("support_messages")
      .select("id, role, content, created_at, metadata")
      .eq("conversation_id", conv.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return {
      id: conv.id,
      escalated: conv.escalated,
      escalated_at: conv.escalated_at,
      escalation_reason: conv.escalation_reason,
      last_message_at: conv.last_message_at,
      messages: (messages ?? []) as SupportMessageRow[],
    };
  });

const adminReplySchema = z.object({
  conversation_id: z.string().uuid(),
  content: z.string().min(1).max(4000),
});

export const postAdminReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => adminReplySchema.parse(d))
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data: isAdmin } = await sb.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin access required");
    const { error } = await sb.from("support_messages").insert({
      conversation_id: data.conversation_id,
      role: "admin",
      author_user_id: context.userId,
      content: data.content,
    });
    if (error) throw error;
    await sb
      .from("support_conversations")
      .update({
        last_message_at: new Date().toISOString(),
        admin_unread_count: 0,
      })
      .eq("id", data.conversation_id);
    return { ok: true };
  });

export const listEscalatedConversations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data: isAdmin } = await sb.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin access required");
    const { data, error } = await sb
      .from("support_conversations")
      .select(
        "id, user_id, escalated, escalated_at, escalation_reason, last_message_at, admin_unread_count, status",
      )
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) throw error;

    // Attach profile display_name + email hint (masked).
    const rows = (data ?? []) as Array<{
      id: string;
      user_id: string;
      escalated: boolean;
      escalated_at: string | null;
      escalation_reason: string | null;
      last_message_at: string;
      admin_unread_count: number;
      status: string;
    }>;
    if (rows.length === 0) return { rows: [] as typeof rows };
    const { data: profiles } = await sb
      .from("profiles")
      .select("user_id, display_name")
      .in(
        "user_id",
        rows.map((r) => r.user_id),
      );
    const nameByUser = new Map<string, string>();
    for (const p of (profiles ?? []) as Array<{
      user_id: string;
      display_name: string | null;
    }>) {
      if (p.display_name) nameByUser.set(p.user_id, p.display_name);
    }
    return {
      rows: rows.map((r) => ({
        ...r,
        display_name: nameByUser.get(r.user_id) ?? null,
      })),
    };
  });

export const getConversationMessages = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ conversation_id: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = context.supabase as any;
    const { data: isAdmin } = await sb.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (!isAdmin) throw new Error("Admin access required");
    const { data: messages, error } = await sb
      .from("support_messages")
      .select("id, role, content, created_at, metadata, author_user_id")
      .eq("conversation_id", data.conversation_id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return { messages: (messages ?? []) as SupportMessageRow[] };
  });
