import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

/**
 * Public read of a single event's full details. RLS on `events` scopes what an
 * `anon` caller sees (published, non-private rows), matching what an
 * unauthenticated visitor would see. Use `list_upcoming_events` first to
 * discover valid event ids.
 */
function anonClient() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "get_event_details",
  title: "Get event details",
  description:
    "Fetch the full public details for a single event by id: description, schedule (starts_at / ends_at), house rules (dress_code, theme, waiver_text), and venue info (venue_name, address, city, capacity). Returns not-found if the event is private, unpublished, or does not exist.",
  inputSchema: {
    event_id: z.string().uuid().describe("The UUID of the event to fetch."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ event_id }, _ctx: ToolContext) => {
    const { data, error } = await anonClient()
      .from("events")
      .select(
        [
          "id",
          "title",
          "tagline",
          "description",
          "venue_name",
          "address",
          "city",
          "starts_at",
          "ends_at",
          "dress_code",
          "theme",
          "capacity",
          "ticket_price_cents",
          "cover_image_url",
          "waiver_text",
        ].join(", "),
      )
      .eq("id", event_id)
      .eq("published", true)
      .eq("is_private", false)
      .maybeSingle();

    if (error) {
      return {
        content: [{ type: "text", text: `Failed to load event: ${error.message}` }],
        isError: true,
      };
    }
    if (!data) {
      return {
        content: [
          {
            type: "text",
            text: `No public event found with id ${event_id}. It may be private, unpublished, or the id may be wrong.`,
          },
        ],
        isError: true,
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
      structuredContent: { event: data },
    };
  },
});
