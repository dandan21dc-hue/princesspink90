import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

/**
 * Self check-in for the signed-in user's own RSVP, matched by entry code.
 * Runs under RLS as the caller, so the update only succeeds when the RSVP
 * belongs to that user (the "user updates own rsvp" policy). Idempotent:
 * an already-checked-in RSVP returns its existing check-in timestamp.
 */
function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "check_in_to_event",
  title: "Check in to event",
  description:
    "Check the signed-in user in to their RSVP using its entry code (e.g. `PINK-123`). Returns whether check-in succeeded and the check-in timestamp. Idempotent — re-running on an already checked-in RSVP returns the existing timestamp.",
  inputSchema: {
    entry_code: z
      .string()
      .trim()
      .min(1)
      .describe("The RSVP's entry code, e.g. `PINK-123`. Case-insensitive."),
  },
  annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false, openWorldHint: false },
  handler: async ({ entry_code }, ctx: ToolContext) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const code = entry_code.toUpperCase();
    const userId = ctx.getUserId();

    // Look up the caller's RSVP by entry code. RLS scopes SELECT to the
    // caller's own rows, so a wrong or foreign code returns null.
    const { data: existing, error: findErr } = await supabase
      .from("rsvps")
      .select("id, event_id, entry_code, status, checked_in_at, events(title, starts_at, venue_name)")
      .eq("entry_code", code)
      .eq("user_id", userId)
      .maybeSingle();

    if (findErr) {
      return {
        content: [{ type: "text", text: `Failed to look up RSVP: ${findErr.message}` }],
        isError: true,
      };
    }
    if (!existing) {
      return {
        content: [
          {
            type: "text",
            text: `No RSVP found on your account with entry code ${code}. Double-check the code.`,
          },
        ],
        structuredContent: { success: false, reason: "not_found", entry_code: code },
        isError: true,
      };
    }

    const eventTitle = Array.isArray(existing.events)
      ? existing.events[0]?.title
      : (existing.events as { title?: string } | null)?.title;

    if (existing.checked_in_at) {
      return {
        content: [
          {
            type: "text",
            text: `Already checked in to "${eventTitle ?? "event"}" at ${existing.checked_in_at}.`,
          },
        ],
        structuredContent: {
          success: true,
          already_checked_in: true,
          rsvp_id: existing.id,
          checked_in_at: existing.checked_in_at,
        },
      };
    }

    if (existing.status === "cancelled") {
      return {
        content: [
          { type: "text", text: `RSVP ${code} is cancelled and cannot be checked in.` },
        ],
        structuredContent: { success: false, reason: "cancelled", rsvp_id: existing.id },
        isError: true,
      };
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updErr } = await supabase
      .from("rsvps")
      .update({ checked_in_at: nowIso, checked_in_by: userId })
      .eq("id", existing.id)
      .eq("user_id", userId)
      .select("id, event_id, entry_code, status, checked_in_at")
      .single();

    if (updErr) {
      return {
        content: [{ type: "text", text: `Check-in failed: ${updErr.message}` }],
        structuredContent: { success: false, reason: "update_failed", rsvp_id: existing.id },
        isError: true,
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Checked in to "${eventTitle ?? "event"}" at ${updated.checked_in_at}. Entry code: ${updated.entry_code}.`,
        },
      ],
      structuredContent: {
        success: true,
        already_checked_in: false,
        rsvp_id: updated.id,
        event_id: updated.event_id,
        entry_code: updated.entry_code,
        checked_in_at: updated.checked_in_at,
      },
    };
  },
});
