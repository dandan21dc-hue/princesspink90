import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GoLiveDiagnostic = {
  label: string;
  status: "ok" | "warn" | "fail" | "unknown";
  detail: string;
  // Optional structured extras any check may include.
  recent_total?: number | null;
  recent_missing?: number | null;
  last_assigned_at?: string | null;
  total?: number | null;
  sent?: number | null;
  pending?: number | null;
  failed?: number | null;
  suppressed?: number | null;
  last_at?: string | null;
  last_status?: string | null;
  last_error?: string | null;
  queue_auth?: number | null;
  queue_transactional?: number | null;
  cron_active?: boolean | null;
  retry_after_until?: string | null;
};

export type GoLiveStatus = {
  cron_jobs: Array<{ jobname: string; schedule: string; active: boolean }>;
  last_email_sent_at: string | null;
  last_email_template: string | null;
  last_email_recipient: string | null;
  rsvp_total: number;
  rsvp_with_entry_phrase: number;
  last_entry_phrase_at: string | null;
  diagnostics?: GoLiveDiagnostic[];
};



export const getGoLiveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GoLiveStatus> => {
    // Authorize caller as admin, then invoke via service role
    // (RPC EXECUTE is granted only to service_role).
    const { data: isAdmin, error: roleError } = await context.supabase.rpc("has_role", {
      _user_id: context.userId,
      _role: "admin",
    });
    if (roleError) throw roleError;
    if (!isAdmin) throw new Error("Admin access required");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin.rpc("go_live_status");
    if (error) throw error;
    return data as GoLiveStatus;
  });
