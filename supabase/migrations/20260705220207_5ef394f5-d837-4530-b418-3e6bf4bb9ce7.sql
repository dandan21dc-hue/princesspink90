CREATE OR REPLACE FUNCTION public.go_live_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'cron', 'pgmq'
AS $function$
DECLARE
  is_admin boolean;
  result jsonb;
  jobs jsonb;
  last_sent timestamptz;
  last_sent_template text;
  last_sent_recipient text;
  rsvp_total integer;
  rsvp_with_phrase integer;
  last_phrase_at timestamptz;
  rsvp_recent_total integer;
  rsvp_recent_missing_phrase integer;
  signup_total integer;
  signup_sent integer;
  signup_pending integer;
  signup_failed integer;
  signup_suppressed integer;
  last_signup_at timestamptz;
  last_signup_status text;
  last_signup_error text;
  queue_auth bigint := 0;
  queue_trans bigint := 0;
  queue_retry_after timestamptz;
  cron_email_active boolean := false;
  diag_trigger jsonb;
  diag_webhook jsonb;
  diag_queue jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO is_admin;
  IF NOT COALESCE(is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(j) ORDER BY j.jobname), '[]'::jsonb) INTO jobs
  FROM (SELECT jobname, schedule, active FROM cron.job) j;

  SELECT EXISTS(SELECT 1 FROM cron.job WHERE jobname = 'process-email-queue' AND active)
    INTO cron_email_active;

  SELECT created_at, template_name, recipient_email
    INTO last_sent, last_sent_template, last_sent_recipient
  FROM public.email_send_log
  WHERE status = 'sent'
  ORDER BY created_at DESC
  LIMIT 1;

  -- RSVP entry_phrase coverage (all time + last 24h)
  SELECT count(*),
         count(*) FILTER (WHERE entry_phrase IS NOT NULL AND btrim(entry_phrase) <> ''),
         max(created_at) FILTER (WHERE entry_phrase IS NOT NULL AND btrim(entry_phrase) <> '')
    INTO rsvp_total, rsvp_with_phrase, last_phrase_at
  FROM public.rsvps;

  SELECT count(*),
         count(*) FILTER (WHERE entry_phrase IS NULL OR btrim(entry_phrase) = '')
    INTO rsvp_recent_total, rsvp_recent_missing_phrase
  FROM public.rsvps
  WHERE created_at > now() - interval '24 hours';

  -- Signup email pipeline (dedup by message_id -> latest status)
  WITH latest AS (
    SELECT DISTINCT ON (message_id) status, error_message, created_at
    FROM public.email_send_log
    WHERE template_name = 'signup' AND message_id IS NOT NULL
    ORDER BY message_id, created_at DESC
  )
  SELECT
    count(*),
    count(*) FILTER (WHERE status = 'sent'),
    count(*) FILTER (WHERE status = 'pending'),
    count(*) FILTER (WHERE status IN ('dlq','failed','bounced')),
    count(*) FILTER (WHERE status = 'suppressed')
  INTO signup_total, signup_sent, signup_pending, signup_failed, signup_suppressed
  FROM latest;

  SELECT created_at, status, error_message
    INTO last_signup_at, last_signup_status, last_signup_error
  FROM public.email_send_log
  WHERE template_name = 'signup'
  ORDER BY created_at DESC
  LIMIT 1;

  -- Queue depths (missing pgmq tables = 0, that's healthy on-demand state)
  BEGIN SELECT count(*) INTO queue_auth FROM pgmq.q_auth_emails;
  EXCEPTION WHEN undefined_table THEN queue_auth := 0; END;
  BEGIN SELECT count(*) INTO queue_trans FROM pgmq.q_transactional_emails;
  EXCEPTION WHEN undefined_table THEN queue_trans := 0; END;

  SELECT retry_after_until INTO queue_retry_after
  FROM public.email_send_state WHERE id = 1;

  -- Diagnostic rollups ------------------------------------------------------
  diag_trigger := jsonb_build_object(
    'label', 'RSVP entry_phrase trigger',
    'status',
      CASE
        WHEN rsvp_recent_total = 0 AND rsvp_total = 0 THEN 'unknown'
        WHEN rsvp_recent_total > 0 AND rsvp_recent_missing_phrase = 0 THEN 'ok'
        WHEN rsvp_recent_total > 0 AND rsvp_recent_missing_phrase > 0 THEN 'fail'
        WHEN rsvp_total > 0 AND rsvp_with_phrase = 0 THEN 'fail'
        ELSE 'ok'
      END,
    'detail',
      CASE
        WHEN rsvp_recent_total = 0 AND rsvp_total = 0 THEN 'No RSVPs yet to verify trigger'
        WHEN rsvp_recent_missing_phrase > 0 THEN
          rsvp_recent_missing_phrase || '/' || rsvp_recent_total || ' RSVPs in the last 24h are missing entry_phrase'
        ELSE
          rsvp_with_phrase || '/' || rsvp_total || ' RSVPs have entry_phrase (' || rsvp_recent_total || ' in last 24h)'
      END,
    'recent_total', rsvp_recent_total,
    'recent_missing', rsvp_recent_missing_phrase,
    'last_assigned_at', last_phrase_at
  );

  diag_webhook := jsonb_build_object(
    'label', 'Signup email webhook',
    'status',
      CASE
        WHEN signup_total = 0 THEN 'unknown'
        ELSE 'ok'
      END,
    'detail',
      CASE
        WHEN signup_total = 0 THEN 'No signup email has ever been enqueued — auth webhook may not be reaching /lovable/email/auth/webhook'
        ELSE signup_total || ' signup emails enqueued (' || signup_sent || ' sent, ' || signup_pending || ' pending, ' || signup_failed || ' failed, ' || signup_suppressed || ' suppressed)'
      END,
    'total', signup_total,
    'sent', signup_sent,
    'pending', signup_pending,
    'failed', signup_failed,
    'suppressed', signup_suppressed,
    'last_at', last_signup_at,
    'last_status', last_signup_status,
    'last_error', last_signup_error
  );

  diag_queue := jsonb_build_object(
    'label', 'Email queue processor',
    'status',
      CASE
        WHEN signup_failed > 0 OR signup_pending > 5 THEN 'fail'
        WHEN (queue_auth + queue_trans) > 0 AND NOT cron_email_active THEN 'fail'
        WHEN queue_retry_after IS NOT NULL AND queue_retry_after > now() THEN 'warn'
        WHEN signup_total > 0 AND signup_sent = 0 AND signup_pending = 0 THEN 'warn'
        ELSE 'ok'
      END,
    'detail',
      CASE
        WHEN signup_failed > 0 THEN signup_failed || ' signup emails failed / went to DLQ — inspect email_send_log.error_message'
        WHEN (queue_auth + queue_trans) > 0 AND NOT cron_email_active THEN
          (queue_auth + queue_trans) || ' messages queued but process-email-queue cron is not active'
        WHEN queue_retry_after IS NOT NULL AND queue_retry_after > now() THEN
          'Provider rate-limited; retrying after ' || to_char(queue_retry_after, 'YYYY-MM-DD HH24:MI:SSTZ')
        WHEN signup_pending > 5 THEN signup_pending || ' signup emails stuck in pending'
        ELSE 'Queues drained (auth=' || queue_auth || ', transactional=' || queue_trans || '), cron ' ||
             CASE WHEN cron_email_active THEN 'active' ELSE 'idle (on-demand)' END
      END,
    'queue_auth', queue_auth,
    'queue_transactional', queue_trans,
    'cron_active', cron_email_active,
    'retry_after_until', queue_retry_after
  );

  result := jsonb_build_object(
    'cron_jobs', jobs,
    'last_email_sent_at', last_sent,
    'last_email_template', last_sent_template,
    'last_email_recipient', last_sent_recipient,
    'rsvp_total', COALESCE(rsvp_total, 0),
    'rsvp_with_entry_phrase', COALESCE(rsvp_with_phrase, 0),
    'last_entry_phrase_at', last_phrase_at,
    'diagnostics', jsonb_build_array(diag_trigger, diag_webhook, diag_queue)
  );

  RETURN result;
END;
$function$;