
CREATE TABLE public.booking_rejection_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  attempt_kind TEXT NOT NULL CHECK (attempt_kind IN ('create','reschedule_self','reschedule_admin')),
  attempted_starts_at TIMESTAMPTZ,
  duration_minutes INTEGER,
  reason_code TEXT NOT NULL,
  reason_message TEXT NOT NULL,
  booking_id UUID,
  conflict_booking_ids UUID[] NOT NULL DEFAULT ARRAY[]::UUID[],
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.booking_rejection_log TO authenticated;
GRANT ALL ON public.booking_rejection_log TO service_role;

ALTER TABLE public.booking_rejection_log ENABLE ROW LEVEL SECURITY;

-- Only admins can read the rejection log. Writes go through service_role from
-- server functions, which bypasses RLS.
CREATE POLICY "Admins can read booking rejection log"
  ON public.booking_rejection_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_booking_rejection_log_created_at
  ON public.booking_rejection_log (created_at DESC);
CREATE INDEX idx_booking_rejection_log_kind_created_at
  ON public.booking_rejection_log (attempt_kind, created_at DESC);
CREATE INDEX idx_booking_rejection_log_user_id
  ON public.booking_rejection_log (user_id)
  WHERE user_id IS NOT NULL;
