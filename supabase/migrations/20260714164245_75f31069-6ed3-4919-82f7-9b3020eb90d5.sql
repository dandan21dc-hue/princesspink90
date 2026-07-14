
-- Admin activity audit log with configurable retention

CREATE TABLE IF NOT EXISTS public.admin_activity_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id UUID NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.admin_activity_audit TO authenticated;
GRANT ALL ON public.admin_activity_audit TO service_role;

ALTER TABLE public.admin_activity_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit entries"
  ON public.admin_activity_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert their own audit entries"
  ON public.admin_activity_audit FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND actor_id = auth.uid()
  );

CREATE INDEX IF NOT EXISTS admin_activity_audit_created_at_idx
  ON public.admin_activity_audit (created_at DESC);
CREATE INDEX IF NOT EXISTS admin_activity_audit_actor_idx
  ON public.admin_activity_audit (actor_id, created_at DESC);

-- Retention configuration (single-row)
CREATE TABLE IF NOT EXISTS public.admin_activity_audit_retention (
  id BOOLEAN NOT NULL PRIMARY KEY DEFAULT true CHECK (id = true),
  retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days >= 1 AND retention_days <= 3650),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

GRANT SELECT, INSERT, UPDATE ON public.admin_activity_audit_retention TO authenticated;
GRANT ALL ON public.admin_activity_audit_retention TO service_role;

ALTER TABLE public.admin_activity_audit_retention ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read retention config"
  ON public.admin_activity_audit_retention FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert retention config"
  ON public.admin_activity_audit_retention FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update retention config"
  ON public.admin_activity_audit_retention FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

INSERT INTO public.admin_activity_audit_retention (id, retention_days)
VALUES (true, 90)
ON CONFLICT (id) DO NOTHING;

-- Purge function honoring configured retention
CREATE OR REPLACE FUNCTION public.purge_expired_admin_activity_audit()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  days INTEGER;
  purged INTEGER;
BEGIN
  SELECT retention_days INTO days
  FROM public.admin_activity_audit_retention
  WHERE id = true;

  IF days IS NULL THEN
    days := 90;
  END IF;

  WITH deleted AS (
    DELETE FROM public.admin_activity_audit
    WHERE created_at < (now() - (days || ' days')::interval)
    RETURNING 1
  )
  SELECT count(*) INTO purged FROM deleted;

  RETURN purged;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_admin_activity_audit() FROM public;
GRANT EXECUTE ON FUNCTION public.purge_expired_admin_activity_audit() TO service_role;

-- Daily retention job
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-admin-activity-audit')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-admin-activity-audit');
    PERFORM cron.schedule(
      'purge-admin-activity-audit',
      '17 3 * * *',
      $cron$ SELECT public.purge_expired_admin_activity_audit(); $cron$
    );
  END IF;
END $$;
