CREATE TABLE IF NOT EXISTS public.health_screening_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  screening_id uuid NOT NULL REFERENCES public.health_screenings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  reminder_type text NOT NULL DEFAULT 'expiry_7_day',
  valid_until date NOT NULL,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'sent',
  error_message text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT health_screening_reminder_log_idempotency_key_unique UNIQUE (idempotency_key)
);

GRANT SELECT ON public.health_screening_reminder_log TO authenticated;
GRANT ALL  ON public.health_screening_reminder_log TO service_role;

ALTER TABLE public.health_screening_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view reminder log"
  ON public.health_screening_reminder_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_hsr_log_screening ON public.health_screening_reminder_log(screening_id);
CREATE INDEX IF NOT EXISTS idx_hsr_log_created_at ON public.health_screening_reminder_log(created_at DESC);