import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const HANDBOOK_VERSION = "1.0";

export type CohostHandbookAck = {
  id: string;
  user_id: string;
  handbook_version: string;
  acknowledged_at: string;
};

export const getMyHandbookAck = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("cohost_handbook_acknowledgements")
      .select("id, user_id, handbook_version, acknowledged_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data ?? null) as CohostHandbookAck | null;
  });

export const acknowledgeHandbook = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;

    const existing = await supabase
      .from("cohost_handbook_acknowledgements")
      .select("id, user_id, handbook_version, acknowledged_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data) return existing.data as CohostHandbookAck;

    const { data, error } = await supabase
      .from("cohost_handbook_acknowledgements")
      .insert({ user_id: userId, handbook_version: HANDBOOK_VERSION })
      .select("id, user_id, handbook_version, acknowledged_at")
      .single();
    if (error) throw new Error(error.message);
    return data as CohostHandbookAck;
  });
