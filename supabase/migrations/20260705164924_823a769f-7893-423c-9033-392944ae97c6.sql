
CREATE TYPE public.event_doc_type AS ENUM ('permit','insurance','capacity','other');

CREATE TABLE public.event_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  doc_type public.event_doc_type NOT NULL,
  file_path text NOT NULL UNIQUE,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX event_documents_event_id_idx ON public.event_documents(event_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_documents TO authenticated;
GRANT ALL ON public.event_documents TO service_role;

ALTER TABLE public.event_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Hosts view own event documents" ON public.event_documents
FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.host_id = auth.uid()));

CREATE POLICY "Admins view all event documents" ON public.event_documents
FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Hosts add own event documents" ON public.event_documents
FOR INSERT TO authenticated
WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.host_id = auth.uid())
);

CREATE POLICY "Hosts delete own event documents" ON public.event_documents
FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.events e WHERE e.id = event_id AND e.host_id = auth.uid()));

-- Storage policies for event-documents bucket
-- Path convention: {event_id}/{uuid}-{filename}
CREATE POLICY "Hosts read own event files" ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'event-documents'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id::text = (storage.foldername(name))[1] AND e.host_id = auth.uid()
  )
);

CREATE POLICY "Admins read all event files" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'event-documents' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Hosts upload own event files" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'event-documents'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id::text = (storage.foldername(name))[1] AND e.host_id = auth.uid()
  )
);

CREATE POLICY "Hosts delete own event files" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'event-documents'
  AND EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.id::text = (storage.foldername(name))[1] AND e.host_id = auth.uid()
  )
);
