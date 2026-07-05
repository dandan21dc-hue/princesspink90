
CREATE TABLE IF NOT EXISTS public.cron_health_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_type text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  job_name text,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS cron_health_alerts_created_at_idx
  ON public.cron_health_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS cron_health_alerts_unresolved_idx
  ON public.cron_health_alerts (created_at DESC) WHERE resolved_at IS NULL;

GRANT SELECT ON public.cron_health_alerts TO authenticated;
GRANT ALL ON public.cron_health_alerts TO service_role;

ALTER TABLE public.cron_health_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view cron health alerts"
  ON public.cron_health_alerts
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can resolve cron health alerts"
  ON public.cron_health_alerts
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE OR REPLACE FUNCTION public.cron_health_snapshot()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron, pgmq
AS $$
DECLARE
  is_admin boolean;
  jobs jsonb;
  queue_auth bigint := 0;
  queue_trans bigint := 0;
  emails_1h integer := 0;
  emails_24h integer := 0;
  last_email timestamptz;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO is_admin;
  IF NOT COALESCE(is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(x) ORDER BY x.jobname), '[]'::jsonb) INTO jobs
  FROM (
    SELECT
      j.jobname,
      j.schedule,
      j.active,
      (SELECT max(d.start_time) FROM cron.job_run_details d WHERE d.jobid = j.jobid) AS last_run_at,
      (SELECT d.status FROM cron.job_run_details d WHERE d.jobid = j.jobid ORDER BY d.start_time DESC LIMIT 1) AS last_status
    FROM cron.job j
  ) x;

  BEGIN
    SELECT count(*) INTO queue_auth FROM pgmq.q_auth_emails;
  EXCEPTION WHEN undefined_table THEN queue_auth := 0;
  END;
  BEGIN
    SELECT count(*) INTO queue_trans FROM pgmq.q_transactional_emails;
  EXCEPTION WHEN undefined_table THEN queue_trans := 0;
  END;

  SELECT count(*) INTO emails_1h FROM public.email_send_log
    WHERE created_at > now() - interval '1 hour';
  SELECT count(*) INTO emails_24h FROM public.email_send_log
    WHERE created_at > now() - interval '24 hours';
  SELECT max(created_at) INTO last_email FROM public.email_send_log
    WHERE status = 'sent';

  RETURN jsonb_build_object(
    'now', now(),
    'cron_jobs', jobs,
    'queues', jsonb_build_object(
      'auth_emails', queue_auth,
      'transactional_emails', queue_trans
    ),
    'email_activity', jsonb_build_object(
      'sent_last_1h', emails_1h,
      'logged_last_24h', emails_24h,
      'last_sent_at', last_email
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cron_health_snapshot() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cron_health_snapshot() TO authenticated, service_role;
