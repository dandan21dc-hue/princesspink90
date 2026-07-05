
ALTER TABLE public.cohost_applications
  ADD COLUMN IF NOT EXISTS relevant_experience text,
  ADD COLUMN IF NOT EXISTS agreement_file_path text,
  ADD COLUMN IF NOT EXISTS agreement_uploaded_at timestamptz;

-- Storage policies for cohost-agreements bucket
CREATE POLICY "Users upload own cohost agreement"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'cohost-agreements'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users read own cohost agreement"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'cohost-agreements'
  AND (
    (storage.foldername(name))[1] = auth.uid()::text
    OR public.has_role(auth.uid(), 'admin')
  )
);

CREATE POLICY "Users update own cohost agreement"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'cohost-agreements'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

CREATE POLICY "Users delete own cohost agreement"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'cohost-agreements'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
