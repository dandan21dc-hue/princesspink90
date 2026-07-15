import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_my_rsvps",
  title: "List my RSVPs",
  description:
    "List the signed-in user's RSVPs (event_id, status, entry_code, entry_phrase, guest_count, check-in state). Runs under RLS as that user.",
  inputSchema: {
    upcomingOnly: z
      .boolean()
      .default(true)
      .describe("When true, only return RSVPs for events that haven't started yet."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ upcomingOnly }, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return {
        content: [{ type: "text", text: "Not authenticated" }],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);
    // Fetch RSVPs for the caller. RLS restricts the row set to the user's own
    // RSVPs, so we do not filter by user_id in the query.
    let query = supabase
      .from("rsvps")
      .select(
        "id, event_id, status, entry_code, entry_phrase, guest_count, checked_in_at, created_at, events(title, starts_at, venue_name)",
      )
      .order("created_at", { ascending: false })
      .limit(100);

    if (upcomingOnly) {
      query = query.gte("events.starts_at", new Date().toISOString());
    }

    const { data, error } = await query;
    if (error) {
      return {
        content: [{ type: "text", text: `Failed to load RSVPs: ${error.message}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { rsvps: data ?? [] },
    };
  },
});
