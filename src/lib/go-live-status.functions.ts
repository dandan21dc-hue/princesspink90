import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type GoLiveStatus = {
  cron_jobs: Array<{ jobname: string; schedule: string; active: boolean }>;
  last_email_sent_at: string | null;
  last_email_template: string | null;
  last_email_recipient: string | null;
  rsvp_total: number;
  rsvp_with_entry_phrase: number;
  last_entry_phrase_at: string | null;
};

export const getGoLiveStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<GoLiveStatus> => {
    const { data, error } = await context.supabase.rpc("go_live_status");
    if (error) throw error;
    return data as GoLiveStatus;
  });
