CREATE TABLE public.waiver_audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  rsvp_id UUID REFERENCES public.rsvps(id) ON DELETE SET NULL,
  user_id UUID NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('accepted','re_accepted','rescinded')),
  waiver_text_hash TEXT,
  waiver_signature TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX waiver_audit_log_event_idx ON public.waiver_audit_log(event_id, created_at DESC);
CREATE INDEX waiver_audit_log_user_idx ON public.waiver_audit_log(user_id, created_at DESC);

GRANT SELECT, INSERT ON public.waiver_audit_log TO authenticated;
GRANT ALL ON public.waiver_audit_log TO service_role;

ALTER TABLE public.waiver_audit_log ENABLE ROW LEVEL SECURITY;

-- Guests can see their own audit rows
CREATE POLICY "Users can view own waiver audit entries"
  ON public.waiver_audit_log FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Hosts can see all audit rows for events they own
CREATE POLICY "Hosts can view waiver audit for their events"
  ON public.waiver_audit_log FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id = waiver_audit_log.event_id
      AND e.host_id = auth.uid()
  ));

-- Admins can see all audit rows
CREATE POLICY "Admins can view all waiver audit entries"
  ON public.waiver_audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Users can insert their own audit rows (server writes as the user via requireSupabaseAuth)
CREATE POLICY "Users can insert own waiver audit entries"
  ON public.waiver_audit_log FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
