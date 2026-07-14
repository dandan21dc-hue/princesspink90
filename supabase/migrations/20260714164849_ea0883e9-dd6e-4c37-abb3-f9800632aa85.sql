
-- 1. Add integrity columns
ALTER TABLE public.admin_activity_audit
  ADD COLUMN IF NOT EXISTS seq bigint,
  ADD COLUMN IF NOT EXISTS prev_hash text,
  ADD COLUMN IF NOT EXISTS entry_hash text;

CREATE SEQUENCE IF NOT EXISTS public.admin_activity_audit_seq;

-- Backfill existing rows in created_at order
DO $$
DECLARE r record; prev text := ''; h text; s bigint;
BEGIN
  FOR r IN SELECT id, actor_id, action, resource, metadata, created_at
           FROM public.admin_activity_audit
           WHERE entry_hash IS NULL
           ORDER BY created_at, id LOOP
    s := nextval('public.admin_activity_audit_seq');
    h := encode(digest(prev || s::text || r.id::text || r.actor_id::text || r.action || r.resource || coalesce(r.metadata::text,'') || r.created_at::text, 'sha256'), 'hex');
    UPDATE public.admin_activity_audit
      SET seq = s, prev_hash = prev, entry_hash = h
      WHERE id = r.id;
    prev := h;
  END LOOP;
END $$;

ALTER TABLE public.admin_activity_audit
  ALTER COLUMN seq SET NOT NULL,
  ALTER COLUMN entry_hash SET NOT NULL,
  ALTER COLUMN prev_hash SET NOT NULL,
  ALTER COLUMN seq SET DEFAULT nextval('public.admin_activity_audit_seq');

CREATE UNIQUE INDEX IF NOT EXISTS admin_activity_audit_seq_uniq ON public.admin_activity_audit(seq);

-- 2. BEFORE INSERT trigger to compute chain
CREATE OR REPLACE FUNCTION public.admin_activity_audit_chain()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE last_hash text;
BEGIN
  IF NEW.seq IS NULL THEN
    NEW.seq := nextval('public.admin_activity_audit_seq');
  END IF;
  IF NEW.created_at IS NULL THEN
    NEW.created_at := now();
  END IF;
  SELECT entry_hash INTO last_hash
  FROM public.admin_activity_audit
  ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := coalesce(last_hash, '');
  NEW.entry_hash := encode(
    digest(
      NEW.prev_hash || NEW.seq::text || NEW.id::text || NEW.actor_id::text ||
      NEW.action || NEW.resource || coalesce(NEW.metadata::text,'') || NEW.created_at::text,
      'sha256'
    ),
    'hex'
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS admin_activity_audit_chain_trg ON public.admin_activity_audit;
CREATE TRIGGER admin_activity_audit_chain_trg
BEFORE INSERT ON public.admin_activity_audit
FOR EACH ROW EXECUTE FUNCTION public.admin_activity_audit_chain();

-- 3. Alerts table
CREATE TABLE IF NOT EXISTS public.admin_activity_audit_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  detected_at timestamptz NOT NULL DEFAULT now(),
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  kind text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid
);

GRANT SELECT, UPDATE ON public.admin_activity_audit_alerts TO authenticated;
GRANT ALL ON public.admin_activity_audit_alerts TO service_role;

ALTER TABLE public.admin_activity_audit_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read audit alerts"
  ON public.admin_activity_audit_alerts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can acknowledge audit alerts"
  ON public.admin_activity_audit_alerts FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS admin_activity_audit_alerts_detected_idx
  ON public.admin_activity_audit_alerts(detected_at DESC);

-- 4. Verify function
CREATE OR REPLACE FUNCTION public.verify_admin_activity_audit_integrity()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  expected text;
  prev text := NULL;
  tampered bigint[] := ARRAY[]::bigint[];
  chain_breaks bigint[] := ARRAY[]::bigint[];
  gaps bigint[] := ARRAY[]::bigint[];
  last_seq bigint := NULL;
  total int := 0;
  result jsonb;
  is_admin boolean;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT public.has_role(auth.uid(), 'admin'::app_role) INTO is_admin;
    IF NOT COALESCE(is_admin, false) THEN
      RAISE EXCEPTION 'Admin access required';
    END IF;
  END IF;

  FOR r IN SELECT seq, id, actor_id, action, resource, metadata, created_at, prev_hash, entry_hash
           FROM public.admin_activity_audit
           ORDER BY seq ASC LOOP
    total := total + 1;
    IF last_seq IS NOT NULL AND r.seq <> last_seq + 1 THEN
      FOR i IN (last_seq + 1)..(r.seq - 1) LOOP
        gaps := gaps || i;
      END LOOP;
    END IF;

    expected := encode(
      digest(
        r.prev_hash || r.seq::text || r.id::text || r.actor_id::text ||
        r.action || r.resource || coalesce(r.metadata::text,'') || r.created_at::text,
        'sha256'
      ),
      'hex'
    );
    IF expected <> r.entry_hash THEN
      tampered := tampered || r.seq;
    END IF;

    IF prev IS NOT NULL AND r.prev_hash <> prev AND last_seq IS NOT NULL AND r.seq = last_seq + 1 THEN
      chain_breaks := chain_breaks || r.seq;
    END IF;

    prev := r.entry_hash;
    last_seq := r.seq;
  END LOOP;

  result := jsonb_build_object(
    'checked_at', now(),
    'total', total,
    'tampered_seqs', to_jsonb(tampered),
    'chain_break_seqs', to_jsonb(chain_breaks),
    'missing_seqs', to_jsonb(gaps),
    'ok', (array_length(tampered,1) IS NULL AND array_length(chain_breaks,1) IS NULL AND array_length(gaps,1) IS NULL)
  );

  IF array_length(tampered, 1) IS NOT NULL THEN
    INSERT INTO public.admin_activity_audit_alerts(severity, kind, detail)
    VALUES ('critical', 'tampered_entries',
      jsonb_build_object('seqs', to_jsonb(tampered), 'count', array_length(tampered,1)));
  END IF;
  IF array_length(chain_breaks, 1) IS NOT NULL THEN
    INSERT INTO public.admin_activity_audit_alerts(severity, kind, detail)
    VALUES ('critical', 'chain_break',
      jsonb_build_object('seqs', to_jsonb(chain_breaks), 'count', array_length(chain_breaks,1)));
  END IF;
  IF array_length(gaps, 1) IS NOT NULL THEN
    INSERT INTO public.admin_activity_audit_alerts(severity, kind, detail)
    VALUES ('warning', 'missing_entries',
      jsonb_build_object('seqs', to_jsonb(gaps), 'count', array_length(gaps,1)));
  END IF;

  RETURN result;
END $$;

REVOKE ALL ON FUNCTION public.verify_admin_activity_audit_integrity() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_activity_audit_integrity() TO authenticated, service_role;

-- 5. Nightly verification cron
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'verify-admin-activity-audit') THEN
    PERFORM cron.unschedule('verify-admin-activity-audit');
  END IF;
  PERFORM cron.schedule(
    'verify-admin-activity-audit',
    '30 3 * * *',
    $cron$ SELECT public.verify_admin_activity_audit_integrity(); $cron$
  );
END $$;
