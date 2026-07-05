CREATE TABLE public.safety_incident_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_date date NOT NULL,
  venue text NOT NULL,
  involved_party text NOT NULL,
  nature_of_incident text NOT NULL,
  resolution_taken text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.safety_incident_reports TO authenticated;
GRANT ALL ON public.safety_incident_reports TO service_role;

ALTER TABLE public.safety_incident_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage safety incidents"
  ON public.safety_incident_reports
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER touch_safety_incident_reports_updated_at
  BEFORE UPDATE ON public.safety_incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX safety_incident_reports_date_idx ON public.safety_incident_reports (incident_date DESC);