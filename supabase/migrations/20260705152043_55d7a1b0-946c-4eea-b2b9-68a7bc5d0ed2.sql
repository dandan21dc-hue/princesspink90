
ALTER TABLE public.rsvps
  ADD COLUMN checked_in_at TIMESTAMPTZ,
  ADD COLUMN checked_in_by UUID REFERENCES auth.users(id),
  ADD COLUMN door_notes TEXT,
  ADD COLUMN consent_at_checkin JSONB;

CREATE POLICY "host updates rsvps for own events"
  ON public.rsvps FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = rsvps.event_id AND e.host_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = rsvps.event_id AND e.host_id = auth.uid()
    )
  );
