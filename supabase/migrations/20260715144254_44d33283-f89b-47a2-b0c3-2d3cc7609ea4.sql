-- Add UPDATE policy for content-media storage bucket.
-- Mirrors the existing owner-scoped INSERT/DELETE policies: only the
-- authenticated uploader (or an admin) may modify their own object, and
-- the bucket_id/owner cannot be reassigned to another user via UPDATE.
CREATE POLICY "Users update own content-media"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'content-media'
    AND (
      auth.uid() = owner
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  )
  WITH CHECK (
    bucket_id = 'content-media'
    AND (
      auth.uid() = owner
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );