
-- 1. Enable pg_cron for scheduled purge
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- 2. Minimal audit log so we retain proof-of-processing without keeping health data
CREATE TABLE IF NOT EXISTS public.health_screenings_purge_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_screening_id uuid NOT NULL,
  user_id uuid NOT NULL,
  test_date date,
  valid_until date,
  status text,
  reason text NOT NULL,
  purged_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.health_screenings_purge_log TO authenticated;
GRANT ALL ON public.health_screenings_purge_log TO service_role;

ALTER TABLE public.health_screenings_purge_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read purge log"
  ON public.health_screenings_purge_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Purge function: deletes file from private bucket, logs, then removes the row
CREATE OR REPLACE FUNCTION public.purge_expired_health_screenings()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  rec record;
  purged_count integer := 0;
  reason_text text;
BEGIN
  FOR rec IN
    SELECT id, user_id, file_path, test_date, valid_until, status, submitted_at, reviewed_at
    FROM public.health_screenings
    WHERE
      (valid_until IS NOT NULL AND valid_until < CURRENT_DATE)
      OR (status = 'rejected' AND reviewed_at IS NOT NULL AND reviewed_at < now() - INTERVAL '30 days')
      OR (status = 'pending' AND submitted_at < now() - INTERVAL '90 days')
  LOOP
    IF rec.valid_until IS NOT NULL AND rec.valid_until < CURRENT_DATE THEN
      reason_text := 'expired_validity';
    ELSIF rec.status = 'rejected' THEN
      reason_text := 'rejected_retention_expired';
    ELSE
      reason_text := 'pending_stale';
    END IF;

    -- Delete the underlying file object (Supabase storage server removes the blob when the row is deleted)
    DELETE FROM storage.objects
    WHERE bucket_id = 'health-screenings' AND name = rec.file_path;

    INSERT INTO public.health_screenings_purge_log
      (original_screening_id, user_id, test_date, valid_until, status, reason)
    VALUES
      (rec.id, rec.user_id, rec.test_date, rec.valid_until, rec.status, reason_text);

    DELETE FROM public.health_screenings WHERE id = rec.id;
    purged_count := purged_count + 1;
  END LOOP;

  RETURN purged_count;
END;
$$;

-- 4. Schedule daily at 03:15 UTC (unschedule prior version if it exists)
DO $$
BEGIN
  PERFORM cron.unschedule('purge-expired-health-screenings');
EXCEPTION WHEN OTHERS THEN
  NULL;
END $$;

SELECT cron.schedule(
  'purge-expired-health-screenings',
  '15 3 * * *',
  $$ SELECT public.purge_expired_health_screenings(); $$
);
