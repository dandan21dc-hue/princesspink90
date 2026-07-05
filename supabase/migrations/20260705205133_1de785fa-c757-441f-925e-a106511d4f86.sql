
CREATE OR REPLACE FUNCTION public.go_live_status()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
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
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO is_admin;
  IF NOT COALESCE(is_admin, false) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(j) ORDER BY j.jobname), '[]'::jsonb) INTO jobs
  FROM (
    SELECT jobname, schedule, active
    FROM cron.job
  ) j;

  SELECT created_at, template_name, recipient_email
    INTO last_sent, last_sent_template, last_sent_recipient
  FROM public.email_send_log
  WHERE status = 'sent'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT count(*), count(*) FILTER (WHERE entry_phrase IS NOT NULL), max(created_at) FILTER (WHERE entry_phrase IS NOT NULL)
    INTO rsvp_total, rsvp_with_phrase, last_phrase_at
  FROM public.rsvps;

  result := jsonb_build_object(
    'cron_jobs', jobs,
    'last_email_sent_at', last_sent,
    'last_email_template', last_sent_template,
    'last_email_recipient', last_sent_recipient,
    'rsvp_total', COALESCE(rsvp_total, 0),
    'rsvp_with_entry_phrase', COALESCE(rsvp_with_phrase, 0),
    'last_entry_phrase_at', last_phrase_at
  );

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.go_live_status() TO authenticated;
