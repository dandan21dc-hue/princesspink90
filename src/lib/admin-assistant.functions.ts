import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

/**
 * Admin Command Center — action executor.
 *
 * The AI assistant never mutates data directly. When the model wants to
 * change something it emits a `propose*` tool call whose result is a
 * proposal envelope; the admin then confirms in the UI, which calls this
 * server function. Every confirmed mutation is admin-gated and written to
 * admin_activity_audit.
 */

async function assertAdmin(supabase: any, userId: string) {
  const { data, error } = await supabase.rpc("has_role", {
    _user_id: userId,
    _role: "admin",
  });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Forbidden: admin role required");
}

const CancelBooking = z.object({
  tool: z.literal("cancelBooking"),
  args: z.object({
    id: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  }),
});
const ApproveAsset = z.object({
  tool: z.literal("approveAsset"),
  args: z.object({ id: z.string().uuid() }),
});
const RejectAsset = z.object({
  tool: z.literal("rejectAsset"),
  args: z.object({
    id: z.string().uuid(),
    reason: z.string().trim().min(1).max(500),
  }),
});
const SetListingPublished = z.object({
  tool: z.literal("setListingPublished"),
  args: z.object({
    id: z.string().uuid(),
    published: z.boolean(),
  }),
});
const SetListingSold = z.object({
  tool: z.literal("setListingSold"),
  args: z.object({
    id: z.string().uuid(),
    sold: z.boolean(),
  }),
});

const AdminActionInput = z.discriminatedUnion("tool", [
  CancelBooking,
  ApproveAsset,
  RejectAsset,
  SetListingPublished,
  SetListingSold,
]);

export type AdminAssistantAction = z.infer<typeof AdminActionInput>;

export const executeAdminAssistantAction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => AdminActionInput.parse(input))
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const supabase = context.supabase;
    const actorId = context.userId;
    const nowIso = new Date().toISOString();

    let result: { ok: true; summary: string; detail?: unknown };

    switch (data.tool) {
      case "cancelBooking": {
        const { data: existing, error: readErr } = await supabase
          .from("private_room_bookings")
          .select("id, status, starts_at, user_id")
          .eq("id", data.args.id)
          .maybeSingle();
        if (readErr) throw new Error(readErr.message);
        if (!existing) throw new Error("Booking not found");
        if (existing.status === "cancelled") {
          result = { ok: true, summary: "Booking was already cancelled.", detail: existing };
          break;
        }
        const { data: updated, error: upErr } = await supabase
          .from("private_room_bookings")
          .update({ status: "cancelled", updated_at: nowIso })
          .eq("id", data.args.id)
          .select("id, status, starts_at, user_id")
          .single();
        if (upErr) throw new Error(upErr.message);
        result = {
          ok: true,
          summary: `Cancelled booking ${data.args.id}.`,
          detail: updated,
        };
        break;
      }
      case "approveAsset": {
        const { data: updated, error } = await supabase
          .from("content_items")
          .update({
            moderation_status: "approved",
            moderation_reviewed_by: actorId,
            moderation_reviewed_at: nowIso,
            moderation_notes: null,
          })
          .eq("id", data.args.id)
          .select("id, title, moderation_status")
          .single();
        if (error) throw new Error(error.message);
        result = { ok: true, summary: `Approved asset "${updated.title}".`, detail: updated };
        break;
      }
      case "rejectAsset": {
        const { data: updated, error } = await supabase
          .from("content_items")
          .update({
            moderation_status: "rejected",
            moderation_reviewed_by: actorId,
            moderation_reviewed_at: nowIso,
            moderation_notes: data.args.reason,
          })
          .eq("id", data.args.id)
          .select("id, title, moderation_status")
          .single();
        if (error) throw new Error(error.message);
        result = { ok: true, summary: `Rejected asset "${updated.title}".`, detail: updated };
        break;
      }
      case "setListingPublished": {
        const { data: updated, error } = await supabase
          .from("panty_listings")
          .update({ published: data.args.published, updated_at: nowIso })
          .eq("id", data.args.id)
          .select("id, title, published, sold")
          .single();
        if (error) throw new Error(error.message);
        result = {
          ok: true,
          summary: `${data.args.published ? "Published" : "Unpublished"} listing "${updated.title}".`,
          detail: updated,
        };
        break;
      }
      case "setListingSold": {
        const { data: updated, error } = await supabase
          .from("panty_listings")
          .update({ sold: data.args.sold, updated_at: nowIso })
          .eq("id", data.args.id)
          .select("id, title, published, sold")
          .single();
        if (error) throw new Error(error.message);
        result = {
          ok: true,
          summary: `Marked listing "${updated.title}" as ${data.args.sold ? "sold" : "available"}.`,
          detail: updated,
        };
        break;
      }
    }

    // Hash-chained audit log entry for every confirmed admin mutation.
    await supabase.from("admin_activity_audit").insert({
      actor_id: actorId,
      action: `admin_assistant.${data.tool}`,
      resource: data.args.id,
      metadata: {
        surface: "admin_command_center",
        args: data.args,
        result: result.detail ?? null,
      },
    });

    return result;
  });
