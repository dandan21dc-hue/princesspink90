import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_my_memberships",
  title: "List my memberships",
  description:
    "List the signed-in user's memberships and passes (kind, environment, expires_at, revoked/suspended state). Read-only. Runs under RLS as that user.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return {
        content: [{ type: "text", text: "Not authenticated" }],
        isError: true,
      };
    }
    const { data, error } = await supabaseForUser(ctx)
      .from("memberships")
      .select(
        "id, kind, environment, amount_cents, expires_at, revoked_at, suspended_at, created_at",
      )
      .order("created_at", { ascending: false });
    if (error) {
      return {
        content: [{ type: "text", text: `Failed to load memberships: ${error.message}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { memberships: data ?? [] },
    };
  },
});
