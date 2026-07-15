import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

/**
 * SECURITY: This tool intentionally does NOT create an RSVP.
 *
 * The web app's `rsvpToEvent` server function enforces mandatory
 * compliance gates before granting an entry code: an approved age
 * verification on file, a currently-valid admin-approved health
 * screening, and a fresh signature against the CURRENT waiver text
 * (waiver_text_hash). Those checks require user-supplied inputs
 * (typed legal name signature, explicit acceptance) that cannot be
 * safely captured through the MCP transport, so this tool refuses and
 * hands the user back to the web flow rather than opening a bypass.
 */
export default defineTool({
  name: "create_rsvp",
  title: "Create RSVP",
  description:
    "Refuses to create an RSVP over MCP. Directs the user to the event page in the web app so they can complete age verification, health screening, and the current waiver signature before an entry code is issued.",
  inputSchema: {
    eventId: z.string().uuid().describe("The event's UUID the user wants to RSVP to."),
    // Accepted for compatibility with existing callers; ignored server-side.
    guestCount: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(1)
      .describe("Ignored — collected in the web RSVP form."),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  handler: async ({ eventId }, _ctx: ToolContext) => {
    const url = `/events/${eventId}`;
    const message = [
      "RSVPs must be completed in the web app so the mandatory compliance",
      "checks run: approved age verification, a currently-valid admin-approved",
      "health screening, and a fresh signature against the current event",
      "waiver. Open the event page to finish the RSVP:",
      url,
    ].join(" ");
    return {
      content: [{ type: "text", text: message }],
      structuredContent: {
        action_required: "complete_rsvp_in_web_app",
        event_id: eventId,
        event_url: url,
        reasons: [
          "age_verification_required",
          "current_health_screening_required",
          "waiver_signature_required",
        ],
      },
      isError: false,
    };
  },
});
