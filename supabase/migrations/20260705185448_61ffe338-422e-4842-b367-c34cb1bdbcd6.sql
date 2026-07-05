
CREATE TABLE public.safety_incident_export_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exported_by uuid NOT NULL,
  exported_at timestamptz NOT NULL DEFAULT now(),
  format text NOT NULL CHECK (format IN ('csv','xlsx')),
  view text NOT NULL,
  search text NOT NULL DEFAULT '',
  columns text[] NOT NULL DEFAULT '{}',
  row_count integer NOT NULL DEFAULT 0
);

GRANT SELECT, INSERT ON public.safety_incident_export_log TO authenticated;
GRANT ALL ON public.safety_incident_export_log TO service_role;

ALTER TABLE public.safety_incident_export_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view export log"
  ON public.safety_incident_export_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert their own export log entries"
  ON public.safety_incident_export_log
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    AND exported_by = auth.uid()
  );

CREATE INDEX idx_safety_incident_export_log_exported_at
  ON public.safety_incident_export_log (exported_at DESC);
