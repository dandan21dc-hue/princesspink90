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
  name: "cancel_rsvp",
  title: "Cancel RSVP",
  description:
    "Cancel the signed-in user's RSVP for a specific event (deletes the RSVP row) and confirm the updated state. Runs under RLS as that user.",
  inputSchema: {
    eventId: z.string().uuid().describe("The event's UUID whose RSVP should be cancelled."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: false },
  handler: async ({ eventId }, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return {
        content: [{ type: "text", text: "Not authenticated" }],
        isError: true,
      };
    }
    const supabase = supabaseForUser(ctx);
    const userId = ctx.getUserId();

    // Look up the existing RSVP first so we can report accurately whether
    // there was anything to cancel.
    const { data: existing, error: findError } = await supabase
      .from("rsvps")
      .select("id, event_id, entry_code, checked_in_at, events(title)")
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .maybeSingle();

    if (findError) {
      return {
        content: [{ type: "text", text: `Failed to look up RSVP: ${findError.message}` }],
        isError: true,
      };
    }

    if (!existing) {
      return {
        content: [{ type: "text", text: "No RSVP found for this event — nothing to cancel." }],
        structuredContent: { event_id: eventId, cancelled: false, existed: false },
      };
    }

    if (existing.checked_in_at) {
      return {
        content: [
          {
            type: "text",
            text: "This RSVP has already been checked in at the door and can't be cancelled here.",
          },
        ],
        structuredContent: {
          event_id: eventId,
          cancelled: false,
          existed: true,
          checked_in_at: existing.checked_in_at,
        },
        isError: true,
      };
    }

    const { error: deleteError } = await supabase
      .from("rsvps")
      .delete()
      .eq("id", existing.id);

    if (deleteError) {
      return {
        content: [{ type: "text", text: `Failed to cancel RSVP: ${deleteError.message}` }],
        isError: true,
      };
    }

    const eventTitle = Array.isArray(existing.events)
      ? existing.events[0]?.title
      : (existing.events as { title?: string } | null)?.title;

    return {
      content: [
        {
          type: "text",
          text: `Cancelled your RSVP for "${eventTitle ?? "event"}" (former entry code ${existing.entry_code}).`,
        },
      ],
      structuredContent: {
        event_id: eventId,
        cancelled: true,
        existed: true,
        status: "cancelled",
        former_entry_code: existing.entry_code,
      },
    };
  },
});
