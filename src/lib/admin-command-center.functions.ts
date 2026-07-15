import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Admin Command Center — natural-language backend.
 *
 * ────────────────────────────────────────────────────────────────────────
 *  🔌 PLUG YOUR ADMIN LLM HERE
 * ────────────────────────────────────────────────────────────────────────
 * `adminCommandCenterChat` is the single boundary the Admin Command Center
 * widget talks to. Every call:
 *   1. Verifies the caller is an admin (defence-in-depth on top of RLS).
 *   2. Sends the conversation + a JSON tool schema to your LLM.
 *   3. If the LLM asks for a tool, runs that tool with the admin's
 *      Supabase client (RLS applies as the admin user) and loops.
 *   4. Returns the final assistant reply + a trace of tool calls so the
 *      UI can show what happened.
 *
 * Set `ADMIN_LLM_API_KEY` (and optionally `ADMIN_LLM_ENDPOINT` /
 * `ADMIN_LLM_MODEL`) as project secrets, then replace `callAdminLLM`
 * below with a fetch to your provider (OpenAI, Anthropic, Lovable AI
 * Gateway, self-hosted, etc.). The LLM contract is documented on
 * `callAdminLLM`.
 * ────────────────────────────────────────────────────────────────────────
 */

// ---------- Types ----------

export type AdminChatRole = "user" | "assistant" | "system" | "tool";
export type AdminChatMessage = {
  role: AdminChatRole;
  content: string;
  tool_name?: string;
};
export type AdminToolCall = {
  name: string;
  args: Record<string, unknown>;
  ok: boolean;
  result: unknown;
};
export type AdminChatResponse = {
  reply: string;
  tool_calls: AdminToolCall[];
  llm_configured: boolean;
};

// ---------- Tool schema exposed to the LLM ----------

const TOOL_SCHEMA = [
  {
    name: "list_bookings",
    description:
      "List private-room bookings. Filter by status (pending|confirmed|cancelled), " +
      "customer_email substring, or a time window. Default limit 20, max 100.",
    parameters: {
      status: "string?",
      email_contains: "string?",
      from_iso: "string?",
      to_iso: "string?",
      limit: "number?",
    },
  },
  {
    name: "get_booking",
    description: "Fetch a single booking by id (UUID).",
    parameters: { id: "string (uuid)" },
  },
  {
    name: "cancel_booking",
    description:
      "Cancel a booking by id. Sets status='cancelled'. Idempotent. Requires confirmation from the admin.",
    parameters: { id: "string (uuid)", reason: "string?" },
  },
  {
    name: "list_users",
    description:
      "Search users by email substring. Returns id, email, display_name, roles. Default limit 20.",
    parameters: { email_contains: "string?", limit: "number?" },
  },
  {
    name: "set_user_role",
    description:
      "Grant or revoke a role for a user. role ∈ (admin, co_host, moderator, user). action ∈ (grant, revoke).",
    parameters: {
      user_id: "string (uuid)",
      role: "string",
      action: "string (grant|revoke)",
    },
  },
  {
    name: "list_content_items",
    description:
      "List digital content (assets). Filter by moderation_status (pending|approved|rejected) or title substring.",
    parameters: {
      moderation_status: "string?",
      title_contains: "string?",
      limit: "number?",
    },
  },
  {
    name: "moderate_content_item",
    description:
      "Approve or reject a content item. status ∈ (approved, rejected). Notes optional.",
    parameters: {
      id: "string (uuid)",
      status: "string (approved|rejected)",
      notes: "string?",
    },
  },
  {
    name: "list_panty_listings",
    description:
      "List physical merchandise (panty listings). Filter by sold (bool) or title substring.",
    parameters: { sold: "boolean?", title_contains: "string?", limit: "number?" },
  },
  {
    name: "update_panty_listing",
    description:
      "Update a merchandise listing. Supported fields: title, price_cents, sold, is_active.",
    parameters: {
      id: "string (uuid)",
      title: "string?",
      price_cents: "number?",
      sold: "boolean?",
      is_active: "boolean?",
    },
  },
] as const;

// ---------- Tool executor ----------

function clampLimit(n: unknown, def = 20, max = 100): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.floor(n) : def;
  return Math.max(1, Math.min(max, v));
}

async function runTool(
  supabase: any,
  name: string,
  rawArgs: Record<string, unknown>,
): Promise<{ ok: boolean; result: unknown }> {
  const args = rawArgs || {};
  try {
    switch (name) {
      case "list_bookings": {
        let q = supabase
          .from("private_room_bookings")
          .select(
            "id, user_id, customer_email, starts_at, duration_minutes, status, amount_cents, currency, environment, notes, created_at",
          )
          .order("starts_at", { ascending: false })
          .limit(clampLimit(args.limit));
        if (typeof args.status === "string") q = q.eq("status", args.status);
        if (typeof args.email_contains === "string")
          q = q.ilike("customer_email", `%${args.email_contains}%`);
        if (typeof args.from_iso === "string") q = q.gte("starts_at", args.from_iso);
        if (typeof args.to_iso === "string") q = q.lte("starts_at", args.to_iso);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return { ok: true, result: { rows: data ?? [], count: data?.length ?? 0 } };
      }
      case "get_booking": {
        const { data, error } = await supabase
          .from("private_room_bookings")
          .select("*")
          .eq("id", String(args.id))
          .maybeSingle();
        if (error) throw new Error(error.message);
        return { ok: true, result: data };
      }
      case "cancel_booking": {
        const { data, error } = await supabase
          .from("private_room_bookings")
          .update({ status: "cancelled", updated_at: new Date().toISOString() })
          .eq("id", String(args.id))
          .select("id, status")
          .maybeSingle();
        if (error) throw new Error(error.message);
        return { ok: true, result: { updated: data, reason: args.reason ?? null } };
      }
      case "list_users": {
        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const limit = clampLimit(args.limit);
        const needle =
          typeof args.email_contains === "string" ? args.email_contains.toLowerCase() : "";
        const users: Array<{ id: string; email: string | null; created_at: string | null }> = [];
        let page = 1;
        for (let i = 0; i < 5; i++) {
          const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw new Error(error.message);
          for (const u of data.users) {
            if (!needle || (u.email ?? "").toLowerCase().includes(needle)) {
              users.push({ id: u.id, email: u.email ?? null, created_at: u.created_at ?? null });
              if (users.length >= limit) break;
            }
          }
          if (users.length >= limit || data.users.length < 200) break;
          page += 1;
        }
        const ids = users.map((u) => u.id);
        const [{ data: profiles }, { data: roles }] = await Promise.all([
          supabaseAdmin.from("profiles").select("user_id, display_name").in("user_id", ids),
          supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
        ]);
        const rows = users.map((u) => ({
          ...u,
          display_name: profiles?.find((p) => p.user_id === u.id)?.display_name ?? null,
          roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role),
        }));
        return { ok: true, result: { rows, count: rows.length } };
      }
      case "set_user_role": {
        const role = String(args.role);
        const action = String(args.action);
        const user_id = String(args.user_id);
        if (!["admin", "co_host", "moderator", "user"].includes(role))
          throw new Error("Invalid role");
        if (action === "grant") {
          const { error } = await supabase
            .from("user_roles")
            .upsert({ user_id, role }, { onConflict: "user_id,role" });
          if (error) throw new Error(error.message);
          return { ok: true, result: { granted: { user_id, role } } };
        }
        if (action === "revoke") {
          const { error } = await supabase
            .from("user_roles")
            .delete()
            .eq("user_id", user_id)
            .eq("role", role);
          if (error) throw new Error(error.message);
          return { ok: true, result: { revoked: { user_id, role } } };
        }
        throw new Error("action must be grant or revoke");
      }
      case "list_content_items": {
        let q = supabase
          .from("content_items")
          .select(
            "id, title, kind, moderation_status, creator_id, price_cents, currency, created_at",
          )
          .order("created_at", { ascending: false })
          .limit(clampLimit(args.limit));
        if (typeof args.moderation_status === "string")
          q = q.eq("moderation_status", args.moderation_status);
        if (typeof args.title_contains === "string")
          q = q.ilike("title", `%${args.title_contains}%`);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return { ok: true, result: { rows: data ?? [], count: data?.length ?? 0 } };
      }
      case "moderate_content_item": {
        const status = String(args.status);
        if (!["approved", "rejected"].includes(status))
          throw new Error("status must be approved or rejected");
        const { data, error } = await supabase
          .from("content_items")
          .update({
            moderation_status: status,
            moderation_notes: (args.notes as string) ?? null,
            moderation_reviewed_at: new Date().toISOString(),
          })
          .eq("id", String(args.id))
          .select("id, moderation_status")
          .maybeSingle();
        if (error) throw new Error(error.message);
        return { ok: true, result: data };
      }
      case "list_panty_listings": {
        let q = supabase
          .from("panty_listings")
          .select("id, title, price_cents, currency, sold, is_active, created_at")
          .order("created_at", { ascending: false })
          .limit(clampLimit(args.limit));
        if (typeof args.sold === "boolean") q = q.eq("sold", args.sold);
        if (typeof args.title_contains === "string")
          q = q.ilike("title", `%${args.title_contains}%`);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return { ok: true, result: { rows: data ?? [], count: data?.length ?? 0 } };
      }
      case "update_panty_listing": {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (typeof args.title === "string") patch.title = args.title;
        if (typeof args.price_cents === "number") patch.price_cents = Math.floor(args.price_cents);
        if (typeof args.sold === "boolean") patch.sold = args.sold;
        if (typeof args.is_active === "boolean") patch.is_active = args.is_active;
        const { data, error } = await supabase
          .from("panty_listings")
          .update(patch)
          .eq("id", String(args.id))
          .select("id, title, price_cents, sold, is_active")
          .maybeSingle();
        if (error) throw new Error(error.message);
        return { ok: true, result: data };
      }
      default:
        return { ok: false, result: `Unknown tool: ${name}` };
    }
  } catch (e) {
    return { ok: false, result: (e as Error).message };
  }
}

// ---------- LLM boundary (placeholder) ----------

/**
 * Replace this with a call to your admin LLM.
 *
 * Contract:
 *   Input:  { system: string, tools: <TOOL_SCHEMA>, messages: AdminChatMessage[] }
 *   Output: EITHER
 *     { kind: "message", content: string }              — final answer
 *     { kind: "tool_call", name: string, args: object } — run a tool then loop
 *
 * Recommended provider setup:
 *   const key = process.env.ADMIN_LLM_API_KEY;
 *   const url = process.env.ADMIN_LLM_ENDPOINT ?? "https://api.openai.com/v1/chat/completions";
 *   const model = process.env.ADMIN_LLM_MODEL ?? "gpt-4o-mini";
 *   // POST { model, messages, tools: TOOL_SCHEMA, tool_choice: "auto" }
 *   // Parse response into { kind: "message" | "tool_call", ... } and return it.
 */
type LLMTurn =
  | { kind: "message"; content: string }
  | { kind: "tool_call"; name: string; args: Record<string, unknown> };

async function callAdminLLM(_args: {
  system: string;
  tools: typeof TOOL_SCHEMA;
  messages: AdminChatMessage[];
}): Promise<LLMTurn> {
  // ── Placeholder brain: no LLM configured yet. ─────────────────────────
  // Detects a few obvious intents so the UI is usable end-to-end for
  // testing. Delete this whole block when you wire your provider above.
  const key = process.env.ADMIN_LLM_API_KEY;
  if (key) {
    // TODO: real provider call goes here. For now, we still fall through
    // to the placeholder so the admin sees a clear message.
  }
  const lastUser = [..._args.messages].reverse().find((m) => m.role === "user");
  const text = (lastUser?.content ?? "").toLowerCase();
  const lastTool = [..._args.messages].reverse().find((m) => m.role === "tool");
  if (lastTool) {
    return {
      kind: "message",
      content:
        (key
          ? "(LLM key detected but not wired yet — showing raw tool result.)\n\n"
          : "(No LLM configured — showing raw tool result. Set ADMIN_LLM_API_KEY and wire callAdminLLM.)\n\n") +
        "```json\n" +
        lastTool.content.slice(0, 2000) +
        "\n```",
    };
  }
  if (/unapproved|pending.*(asset|content)|content.*pending/.test(text)) {
    return {
      kind: "tool_call",
      name: "list_content_items",
      args: { moderation_status: "pending", limit: 20 },
    };
  }
  if (/pending.*booking|list.*booking|show.*booking/.test(text)) {
    return {
      kind: "tool_call",
      name: "list_bookings",
      args: { status: "pending", limit: 20 },
    };
  }
  const cancelMatch = text.match(/cancel\s+booking\s+([0-9a-f-]{8,})/);
  if (cancelMatch) {
    return { kind: "tool_call", name: "cancel_booking", args: { id: cancelMatch[1] } };
  }
  if (/user|email/.test(text)) {
    const emailMatch = text.match(/[\w.+-]+@[\w-]+/);
    return {
      kind: "tool_call",
      name: "list_users",
      args: emailMatch ? { email_contains: emailMatch[0] } : { limit: 20 },
    };
  }
  if (/merch|panty|listing|physical/.test(text)) {
    return { kind: "tool_call", name: "list_panty_listings", args: { limit: 20 } };
  }
  return {
    kind: "message",
    content: key
      ? "Admin LLM key found but callAdminLLM is still using the placeholder. Wire your provider in `src/lib/admin-command-center.functions.ts` → `callAdminLLM`."
      : "Admin Command Center is running in placeholder mode. Try: 'List all unapproved assets', 'Show pending bookings', 'Find user alice@…', or 'Cancel booking <uuid>'. Set `ADMIN_LLM_API_KEY` and wire `callAdminLLM` for full natural-language control.",
  };
}

const SYSTEM_PROMPT = `You are the Admin Command Center for AFTERDARK / MIDNIGHT GLORY.
You have tool access to the operational database (bookings, users, digital
content assets, physical merchandise). Prefer read tools first. Confirm
destructive actions (cancel, revoke, delete, reject) with the admin before
running them a second time. Keep replies short and factual — the UI renders
tool results as tables underneath your message.`;

// ---------- Public server function ----------

export const adminCommandCenterChat = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (input: { messages: AdminChatMessage[] }) => {
      if (!input || !Array.isArray(input.messages)) throw new Error("messages required");
      return {
        messages: input.messages
          .filter(
            (m) =>
              m &&
              typeof m === "object" &&
              (m.role === "user" || m.role === "assistant" || m.role === "system" || m.role === "tool") &&
              typeof m.content === "string",
          )
          .slice(-40),
      };
    },
  )
  .handler(async ({ data, context }): Promise<AdminChatResponse> => {
    // Defence in depth — RLS also blocks non-admin writes, but we reject
    // early with a clear error rather than leaking that surface.
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Forbidden: admin role required");

    const tool_calls: AdminToolCall[] = [];
    const convo: AdminChatMessage[] = [...data.messages];

    // Simple bounded tool loop.
    for (let step = 0; step < 6; step++) {
      const turn = await callAdminLLM({
        system: SYSTEM_PROMPT,
        tools: TOOL_SCHEMA,
        messages: convo,
      });
      if (turn.kind === "message") {
        return {
          reply: turn.content,
          tool_calls,
          llm_configured: Boolean(process.env.ADMIN_LLM_API_KEY),
        };
      }
      const out = await runTool(context.supabase, turn.name, turn.args);
      tool_calls.push({ name: turn.name, args: turn.args, ok: out.ok, result: out.result });
      convo.push({
        role: "tool",
        tool_name: turn.name,
        content: JSON.stringify(out.result).slice(0, 4000),
      });
    }
    return {
      reply: "Stopped after 6 tool steps. Ask a narrower question or continue.",
      tool_calls,
      llm_configured: Boolean(process.env.ADMIN_LLM_API_KEY),
    };
  });
