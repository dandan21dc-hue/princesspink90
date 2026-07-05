-- 1. Table
CREATE TABLE public.health_screenings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  file_path text NOT NULL,
  test_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  valid_until date,
  notes text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 2. Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.health_screenings TO authenticated;
GRANT ALL ON public.health_screenings TO service_role;

-- 3. RLS
ALTER TABLE public.health_screenings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own screenings"
  ON public.health_screenings FOR SELECT TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users insert own screenings"
  ON public.health_screenings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users delete own pending screenings"
  ON public.health_screenings FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admins review screenings"
  ON public.health_screenings FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4. updated_at trigger
CREATE TRIGGER health_screenings_touch_updated_at
  BEFORE UPDATE ON public.health_screenings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 5. Storage RLS: user folder = auth.uid()::text
CREATE POLICY "Users upload own health file"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'health-screenings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

CREATE POLICY "Users read own health file"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'health-screenings'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.has_role(auth.uid(), 'admin')
    )
  );

CREATE POLICY "Users delete own health file"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'health-screenings'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );