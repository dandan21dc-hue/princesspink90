
CREATE TABLE public.safety_incident_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incident_id uuid NOT NULL REFERENCES public.safety_incident_reports(id) ON DELETE CASCADE,
  file_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime_type text,
  size_bytes bigint,
  description text,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX safety_incident_attachments_incident_idx
  ON public.safety_incident_attachments(incident_id);

GRANT SELECT, INSERT, DELETE ON public.safety_incident_attachments TO authenticated;
GRANT ALL ON public.safety_incident_attachments TO service_role;

ALTER TABLE public.safety_incident_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view incident attachments"
  ON public.safety_incident_attachments FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins add incident attachments"
  ON public.safety_incident_attachments FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND uploaded_by = auth.uid());

CREATE POLICY "Admins remove incident attachments"
  ON public.safety_incident_attachments FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Storage RLS: admin-only for the private bucket
CREATE POLICY "Admins read safety incident files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'safety-incident-attachments' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins upload safety incident files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'safety-incident-attachments' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete safety incident files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'safety-incident-attachments' AND public.has_role(auth.uid(), 'admin'));
