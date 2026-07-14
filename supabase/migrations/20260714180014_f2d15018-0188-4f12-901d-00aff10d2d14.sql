-- Findings table
CREATE TABLE public.payment_integrity_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_name text NOT NULL,
  resource_kind text NOT NULL,
  resource_id text NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox',
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (check_name, resource_kind, resource_id, environment)
);
GRANT SELECT, UPDATE ON public.payment_integrity_findings TO authenticated;
GRANT ALL ON public.payment_integrity_findings TO service_role;
ALTER TABLE public.payment_integrity_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view integrity findings"
  ON public.payment_integrity_findings FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can update integrity findings"
  ON public.payment_integrity_findings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_payment_integrity_findings_open
  ON public.payment_integrity_findings (check_name, last_seen_at DESC)
  WHERE resolved_at IS NULL;

-- Schedule settings singleton
CREATE TABLE public.payment_integrity_schedule (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  frequency text NOT NULL DEFAULT 'hourly'
    CHECK (frequency IN ('every_15m','hourly','every_6h','daily','weekly')),
  timezone text NOT NULL DEFAULT 'UTC',
  job_name text NOT NULL DEFAULT 'payment-integrity-checks',
  last_applied_schedule text,
  last_applied_at timestamptz,
  last_applied_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_integrity_schedule TO authenticated;
GRANT ALL ON public.payment_integrity_schedule TO service_role;
ALTER TABLE public.payment_integrity_schedule ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can view integrity schedule"
  ON public.payment_integrity_schedule FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.payment_integrity_schedule (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Runner: read-only pipeline checks, upserts findings, auto-resolves cleared ones
CREATE OR REPLACE FUNCTION public.run_payment_integrity_checks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  run_started_at timestamptz := clock_timestamp();
  touched integer := 0;
BEGIN
  -- A) Stuck 'processing' webhooks (>30 min in processing)
  INSERT INTO public.payment_integrity_findings
    (check_name, resource_kind, resource_id, environment, severity, detail)
  SELECT
    'webhook_stuck_processing',
    'stripe_webhook_event',
    w.id::text,
    COALESCE(w.environment, 'sandbox'),
    'critical',
    jsonb_build_object('event_type', w.event_type, 'received_at', w.received_at)
  FROM public.stripe_webhook_events w
  WHERE w.processing_status = 'processing'
    AND w.received_at < now() - interval '30 minutes'
  ON CONFLICT (check_name, resource_kind, resource_id, environment)
  DO UPDATE SET last_seen_at = now(), detail = EXCLUDED.detail, resolved_at = NULL;

  -- B) Active subscriptions past current_period_end (>1 day drift)
  INSERT INTO public.payment_integrity_findings
    (check_name, resource_kind, resource_id, environment, severity, detail)
  SELECT
    'subscription_expired_still_active',
    'subscription',
    s.id::text,
    COALESCE(s.environment, 'sandbox'),
    'warning',
    jsonb_build_object(
      'status', s.status,
      'current_period_end', s.current_period_end,
      'user_id', s.user_id
    )
  FROM public.subscriptions s
  WHERE s.status IN ('active','trialing')
    AND s.current_period_end IS NOT NULL
    AND s.current_period_end < now() - interval '1 day'
  ON CONFLICT (check_name, resource_kind, resource_id, environment)
  DO UPDATE SET last_seen_at = now(), detail = EXCLUDED.detail, resolved_at = NULL;

  -- Auto-resolve findings not re-seen in this run
  UPDATE public.payment_integrity_findings
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND last_seen_at < run_started_at
     AND check_name IN ('webhook_stuck_processing','subscription_expired_still_active');

  SELECT count(*) INTO touched
  FROM public.payment_integrity_findings
  WHERE last_seen_at >= run_started_at;

  RETURN touched;
END;
$$;

-- Apply schedule to pg_cron (admin-gated; migration runs as superuser with auth.uid()=NULL)
CREATE OR REPLACE FUNCTION public.apply_payment_integrity_schedule()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, cron
AS $$
DECLARE
  s public.payment_integrity_schedule;
  base_cron text;
  final_schedule text;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;

  SELECT * INTO s FROM public.payment_integrity_schedule WHERE id = true;
  IF NOT FOUND THEN RAISE EXCEPTION 'payment_integrity_schedule row missing'; END IF;

  base_cron := CASE s.frequency
    WHEN 'every_15m' THEN '*/15 * * * *'
    WHEN 'hourly'    THEN '0 * * * *'
    WHEN 'every_6h'  THEN '0 */6 * * *'
    WHEN 'daily'     THEN '0 3 * * *'
    WHEN 'weekly'    THEN '0 3 * * 1'
  END;

  IF s.timezone IS NOT NULL AND s.timezone <> '' AND s.timezone <> 'UTC' THEN
    final_schedule := 'CRON_TZ=' || s.timezone || ' ' || base_cron;
  ELSE
    final_schedule := base_cron;
  END IF;

  BEGIN
    PERFORM cron.unschedule(s.job_name);
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  PERFORM cron.schedule(
    s.job_name,
    final_schedule,
    $cron$SELECT public.run_payment_integrity_checks();$cron$
  );

  UPDATE public.payment_integrity_schedule
     SET last_applied_schedule = final_schedule,
         last_applied_at = now(),
         last_applied_by = auth.uid(),
         updated_at = now()
   WHERE id = true;

  RETURN final_schedule;
END;
$$;

-- Admin-only update function (writes settings then reapplies the cron job)
CREATE OR REPLACE FUNCTION public.update_payment_integrity_schedule(
  _frequency text,
  _timezone text
)
RETURNS public.payment_integrity_schedule
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result public.payment_integrity_schedule;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF _frequency NOT IN ('every_15m','hourly','every_6h','daily','weekly') THEN
    RAISE EXCEPTION 'invalid frequency: %', _frequency;
  END IF;
  IF _timezone IS NULL OR btrim(_timezone) = '' THEN
    RAISE EXCEPTION 'timezone required';
  END IF;

  -- Validate timezone by attempting to use it
  BEGIN
    PERFORM now() AT TIME ZONE _timezone;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'invalid timezone: %', _timezone;
  END;

  UPDATE public.payment_integrity_schedule
     SET frequency = _frequency,
         timezone = _timezone,
         updated_at = now()
   WHERE id = true
   RETURNING * INTO result;

  PERFORM public.apply_payment_integrity_schedule();
  RETURN result;
END;
$$;

-- Register the initial schedule
SELECT public.apply_payment_integrity_schedule();