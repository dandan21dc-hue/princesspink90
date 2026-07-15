import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Persistent booking-concierge chat history (per signed-in user).
 *
 * Storage strategy:
 *   - Signed-in users → row in `public.concierge_chat_history` (RLS: own row only).
 *   - Guests          → localStorage in the browser (handled in the widget).
 *
 * The message payload is opaque JSON so the widget can freely evolve its
 * `MessagePart` shape without a migration.
 */

// Loose JSON type so evolving MessagePart shapes serialize cleanly.
export type Json =
  | string
  | number
  | boolean
  | null
  | Json[]
  | { [k: string]: Json };

const MAX_MESSAGES = 200;

export const loadConciergeHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ messages: Json[] }> => {
    const { data, error } = await context.supabase
      .from("concierge_chat_history")
      .select("messages")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const raw = (data?.messages ?? []) as unknown;
    const messages = Array.isArray(raw) ? (raw as Json[]) : [];
    return { messages };
  });

export const saveConciergeHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { messages: Json[] }) => {
    if (!input || !Array.isArray(input.messages)) throw new Error("messages required");
    return { messages: input.messages.slice(-MAX_MESSAGES) };
  })
  .handler(async ({ data, context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("concierge_chat_history")
      .upsert(
        {
          user_id: context.userId,
          messages: data.messages as unknown as Json,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" },
      );
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const clearConciergeHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ ok: true }> => {
    const { error } = await context.supabase
      .from("concierge_chat_history")
      .delete()
      .eq("user_id", context.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
