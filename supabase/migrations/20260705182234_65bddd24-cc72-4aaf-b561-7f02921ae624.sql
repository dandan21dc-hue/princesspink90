CREATE TYPE public.venue_compliance_kind AS ENUM ('public_liability_insurance', 'event_permit', 'other');

CREATE TABLE public.venue_compliance_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind public.venue_compliance_kind NOT NULL,
  title text NOT NULL,
  issuer text,
  reference_number text,
  issued_on date,
  expires_on date,
  notes text,
  file_path text NOT NULL,
  file_name text NOT NULL,
  file_size integer,
  file_mime_type text,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.venue_compliance_documents TO authenticated;
GRANT ALL ON public.venue_compliance_documents TO service_role;

ALTER TABLE public.venue_compliance_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage venue compliance docs"
  ON public.venue_compliance_documents
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER touch_venue_compliance_documents_updated_at
  BEFORE UPDATE ON public.venue_compliance_documents
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX venue_compliance_documents_kind_idx
  ON public.venue_compliance_documents (kind, expires_on DESC NULLS LAST);

-- Storage policies (bucket 'venue-compliance' already exists, private)
CREATE POLICY "Admins read venue-compliance files"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'venue-compliance' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins upload venue-compliance files"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'venue-compliance' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update venue-compliance files"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'venue-compliance' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins delete venue-compliance files"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'venue-compliance' AND public.has_role(auth.uid(), 'admin'));