import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

/**
 * Public read of the events catalog. RLS on `events` already scopes what an
 * `anon` caller sees (published, non-private rows in the current environment),
 * so we intentionally use the publishable key with no user token here — every
 * signed-in caller gets the same shortlist an unauthenticated visitor would.
 * The user token is available on `ctx` and could be used to widen the query,
 * but this tool exists specifically to advertise upcoming public events, so
 * that scope match is deliberate.
 */
function anonClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_upcoming_events",
  title: "List upcoming events",
  description:
    "List published, public upcoming events at Princess Pink (id, title, venue, starts_at, ticket price in cents). Use this to find event IDs for other tools.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(10)
      .describe("Maximum number of events to return (1-50)."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ limit }, _ctx: ToolContext) => {
    const { data, error } = await anonClient()
      .from("events")
      .select(
        "id, title, tagline, venue_name, city, starts_at, ends_at, ticket_price_cents, cover_image_url",
      )
      .eq("published", true)
      .eq("is_private", false)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: true })
      .limit(limit);

    if (error) {
      return {
        content: [{ type: "text", text: `Failed to load events: ${error.message}` }],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? [], null, 2) }],
      structuredContent: { events: data ?? [] },
    };
  },
});
