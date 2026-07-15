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
  name: "create_rsvp",
  title: "Create RSVP",
  description:
    "Create an RSVP for a specific event as the signed-in user, and return the RSVP's entry code and current check-in status. Runs under RLS as that user.",
  inputSchema: {
    eventId: z.string().uuid().describe("The event's UUID to RSVP to."),
    guestCount: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe("Number of attendees on this RSVP, including the user (1-10)."),
  },
  annotations: { readOnlyHint: false, idempotentHint: false, destructiveHint: false, openWorldHint: false },
  handler: async ({ eventId, guestCount }, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return {
        content: [{ type: "text", text: "Not authenticated" }],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);

    const { data, error } = await supabase
      .from("rsvps")
      .insert({
        event_id: eventId,
        user_id: ctx.getUserId(),
        guest_count: guestCount,
      })
      .select(
        "id, event_id, status, entry_code, entry_phrase, guest_count, checked_in_at, created_at, events(title, starts_at, venue_name)",
      )
      .single();

    if (error) {
      return {
        content: [{ type: "text", text: `Failed to create RSVP: ${error.message}` }],
        isError: true,
      };
    }

    const checkInStatus = data.checked_in_at ? "checked_in" : "not_checked_in";
    const eventTitle = Array.isArray(data.events) ? data.events[0]?.title : (data.events as { title?: string } | null)?.title;
    const summary = `RSVP confirmed for "${eventTitle ?? "event"}". Entry code: ${data.entry_code}. Check-in status: ${checkInStatus}.`;

    return {
      content: [{ type: "text", text: summary }],
      structuredContent: {
        rsvp: data,
        entry_code: data.entry_code,
        entry_phrase: data.entry_phrase,
        check_in_status: checkInStatus,
        checked_in_at: data.checked_in_at,
      },
    };
  },
});
