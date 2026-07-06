CREATE TABLE public.age_gate_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('confirmed','declined','viewed')),
  path TEXT NULL,
  user_agent TEXT NULL,
  ip_hash TEXT NULL,
  context TEXT NOT NULL DEFAULT 'anonymous' CHECK (context IN ('anonymous','authenticated')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT INSERT ON public.age_gate_events TO anon, authenticated;
GRANT ALL ON public.age_gate_events TO service_role;

ALTER TABLE public.age_gate_events ENABLE ROW LEVEL SECURITY;

-- Anyone (including anonymous visitors) may append an event.
CREATE POLICY "Anyone can log age-gate events"
  ON public.age_gate_events
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    length(coalesce(path, '')) <= 2048
    AND length(coalesce(user_agent, '')) <= 1024
    AND length(coalesce(ip_hash, '')) <= 128
  );

-- Only admins can read the audit trail.
CREATE POLICY "Admins can read age-gate events"
  ON public.age_gate_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX age_gate_events_created_at_idx ON public.age_gate_events (created_at DESC);
CREATE INDEX age_gate_events_outcome_idx ON public.age_gate_events (outcome, created_at DESC);