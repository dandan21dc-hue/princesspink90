
CREATE TABLE public.workspace_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  is_booked boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_slots_time_check CHECK (end_time > start_time)
);

CREATE INDEX workspace_slots_start_idx ON public.workspace_slots (start_time);
CREATE INDEX workspace_slots_end_idx ON public.workspace_slots (end_time);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspace_slots TO authenticated;
GRANT ALL ON public.workspace_slots TO service_role;

ALTER TABLE public.workspace_slots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view workspace slots"
  ON public.workspace_slots FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert workspace slots"
  ON public.workspace_slots FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update workspace slots"
  ON public.workspace_slots FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete workspace slots"
  ON public.workspace_slots FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER workspace_slots_touch_updated_at
  BEFORE UPDATE ON public.workspace_slots
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
