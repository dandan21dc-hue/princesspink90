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
    const { data, error } = await context.supabase.rpc("go_live_status");
    if (error) throw error;
    return data as GoLiveStatus;
  });
