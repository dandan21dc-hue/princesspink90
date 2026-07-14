-- Audit log for session pricing/duration changes on site_settings.
CREATE TABLE public.site_settings_pricing_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_email text,
  old_session_price_cents integer,
  new_session_price_cents integer,
  old_session_duration_minutes integer,
  new_session_duration_minutes integer
);

GRANT SELECT, INSERT ON public.site_settings_pricing_audit TO authenticated;
GRANT ALL ON public.site_settings_pricing_audit TO service_role;

ALTER TABLE public.site_settings_pricing_audit ENABLE ROW LEVEL SECURITY;

-- Only admins may read the audit log.
CREATE POLICY "Admins can read pricing audit"
  ON public.site_settings_pricing_audit
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- No client writes — trigger runs as SECURITY DEFINER via service_role grants.
-- (No INSERT policy for authenticated => inserts from user context are blocked.)

CREATE INDEX site_settings_pricing_audit_changed_at_idx
  ON public.site_settings_pricing_audit (changed_at DESC);

-- Trigger: record any change to session_price_cents or session_duration_minutes.
CREATE OR REPLACE FUNCTION public.log_site_settings_pricing_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  actor_email text;
BEGIN
  IF NEW.session_price_cents IS DISTINCT FROM OLD.session_price_cents
     OR NEW.session_duration_minutes IS DISTINCT FROM OLD.session_duration_minutes THEN
    IF actor IS NOT NULL THEN
      SELECT email INTO actor_email FROM auth.users WHERE id = actor;
    END IF;
    INSERT INTO public.site_settings_pricing_audit (
      changed_by,
      changed_by_email,
      old_session_price_cents,
      new_session_price_cents,
      old_session_duration_minutes,
      new_session_duration_minutes
    ) VALUES (
      actor,
      actor_email,
      OLD.session_price_cents,
      NEW.session_price_cents,
      OLD.session_duration_minutes,
      NEW.session_duration_minutes
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_site_settings_pricing_change ON public.site_settings;
CREATE TRIGGER trg_log_site_settings_pricing_change
  AFTER UPDATE ON public.site_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.log_site_settings_pricing_change();
