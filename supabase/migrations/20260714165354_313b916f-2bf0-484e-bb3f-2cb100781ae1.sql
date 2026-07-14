
CREATE TABLE IF NOT EXISTS public.admin_activity_audit_purge_status (
  id boolean PRIMARY KEY DEFAULT true CHECK (id = true),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_purged_count integer,
  last_status text NOT NULL DEFAULT 'never' CHECK (last_status IN ('never','success','error')),
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.admin_activity_audit_purge_status (id) VALUES (true)
  ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.admin_activity_audit_purge_status TO authenticated;
GRANT ALL ON public.admin_activity_audit_purge_status TO service_role;

ALTER TABLE public.admin_activity_audit_purge_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read purge status"
  ON public.admin_activity_audit_purge_status FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Recreate the purge function to record status.
CREATE OR REPLACE FUNCTION public.purge_expired_admin_activity_audit()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  days INTEGER;
  purged INTEGER := 0;
BEGIN
  SELECT retention_days INTO days
  FROM public.admin_activity_audit_retention
  WHERE id = true;

  IF days IS NULL THEN
    days := 90;
  END IF;

  BEGIN
    WITH deleted AS (
      DELETE FROM public.admin_activity_audit
      WHERE created_at < (now() - (days || ' days')::interval)
      RETURNING 1
    )
    SELECT count(*) INTO purged FROM deleted;

    UPDATE public.admin_activity_audit_purge_status
      SET last_run_at = now(),
          last_success_at = now(),
          last_purged_count = purged,
          last_status = 'success',
          last_error = NULL,
          updated_at = now()
      WHERE id = true;

    RETURN purged;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.admin_activity_audit_purge_status
      SET last_run_at = now(),
          last_status = 'error',
          last_error = SQLERRM,
          updated_at = now()
      WHERE id = true;
    RAISE;
  END;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_admin_activity_audit() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_admin_activity_audit() TO service_role;
