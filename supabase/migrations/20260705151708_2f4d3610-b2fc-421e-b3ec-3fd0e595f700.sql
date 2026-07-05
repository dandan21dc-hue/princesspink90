
-- Age verifications
CREATE TABLE public.age_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  date_of_birth DATE NOT NULL,
  id_file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ,
  reviewed_by UUID REFERENCES auth.users(id),
  notes TEXT
);

GRANT SELECT, INSERT, UPDATE ON public.age_verifications TO authenticated;
GRANT ALL ON public.age_verifications TO service_role;

ALTER TABLE public.age_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own age verification"
  ON public.age_verifications FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can submit their own age verification"
  ON public.age_verifications FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
  );

CREATE POLICY "Users can replace their own pending submission"
  ON public.age_verifications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending' AND reviewed_by IS NULL);

CREATE POLICY "Admins can update any age verification"
  ON public.age_verifications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- RSVP consent columns
ALTER TABLE public.rsvps
  ADD COLUMN age_confirmed_at TIMESTAMPTZ,
  ADD COLUMN consent_confirmed_at TIMESTAMPTZ,
  ADD COLUMN video_consent JSONB NOT NULL DEFAULT '{"private_archive":false,"public_promo":false,"face_blurred_only":false,"no_filming":true}'::jsonb;

-- Storage policies for id-verifications bucket
-- Files are stored under {user_id}/{filename}
CREATE POLICY "Users upload their own ID files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'id-verifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users read their own ID files"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'id-verifications'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin')
    )
  );

CREATE POLICY "Users update their own ID files"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'id-verifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users delete their own ID files"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'id-verifications'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
