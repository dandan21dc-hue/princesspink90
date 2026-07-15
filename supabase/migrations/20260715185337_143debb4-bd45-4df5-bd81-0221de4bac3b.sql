
ALTER TABLE public.compliance_policy_agreements
  ADD COLUMN IF NOT EXISTS archive_path text;

CREATE INDEX IF NOT EXISTS compliance_policy_agreements_user_accepted_idx
  ON public.compliance_policy_agreements (accepted_by_user_id, accepted_at DESC);

-- Storage policies for compliance-archives bucket (admin read-only; server writes as service role, no policy needed).
DROP POLICY IF EXISTS "Admins can read compliance archives" ON storage.objects;
CREATE POLICY "Admins can read compliance archives"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'compliance-archives'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  );
