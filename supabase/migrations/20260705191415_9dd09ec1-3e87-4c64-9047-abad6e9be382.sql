ALTER TABLE public.reminder_job_config
  ADD COLUMN IF NOT EXISTS expiring_within_days integer NOT NULL DEFAULT 7
  CHECK (expiring_within_days BETWEEN 1 AND 90);