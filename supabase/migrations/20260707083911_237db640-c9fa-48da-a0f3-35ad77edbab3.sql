CREATE TABLE public.private_session_slots (
  id uuid primary key default gen_random_uuid(),
  start_time timestamptz not null,
  end_time timestamptz not null,
  is_booked boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  CONSTRAINT private_session_slots_time_order CHECK (end_time > start_time)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.private_session_slots TO authenticated;
GRANT ALL ON public.private_session_slots TO service_role;

ALTER TABLE public.private_session_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view private session slots"
  ON public.private_session_slots FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert private session slots"
  ON public.private_session_slots FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update private session slots"
  ON public.private_session_slots FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete private session slots"
  ON public.private_session_slots FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER private_session_slots_touch_updated_at
  BEFORE UPDATE ON public.private_session_slots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX private_session_slots_start_time_idx ON public.private_session_slots(start_time);