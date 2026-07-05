
CREATE TABLE public.reminder_job_config (
  id text NOT NULL PRIMARY KEY DEFAULT 'default',
  daily_run_time_utc time without time zone NOT NULL DEFAULT '08:00',
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT reminder_job_config_singleton CHECK (id = 'default')
);

GRANT SELECT, INSERT, UPDATE ON public.reminder_job_config TO authenticated;
GRANT ALL ON public.reminder_job_config TO service_role;

ALTER TABLE public.reminder_job_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read reminder job config"
  ON public.reminder_job_config FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update reminder job config"
  ON public.reminder_job_config FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER reminder_job_config_touch_updated_at
  BEFORE UPDATE ON public.reminder_job_config
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed the singleton row with the 08:00 UTC default.
INSERT INTO public.reminder_job_config (id) VALUES ('default')
ON CONFLICT (id) DO NOTHING;
