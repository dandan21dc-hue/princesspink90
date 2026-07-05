CREATE TABLE public.cohost_application_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.cohost_applications(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approved','rejected')),
  notes text,
  previous_status text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cohost_app_reviews_app ON public.cohost_application_reviews(application_id, created_at DESC);

GRANT SELECT, INSERT ON public.cohost_application_reviews TO authenticated;
GRANT ALL ON public.cohost_application_reviews TO service_role;

ALTER TABLE public.cohost_application_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all reviews"
  ON public.cohost_application_reviews FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Applicants can view their own reviews"
  ON public.cohost_application_reviews FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.cohost_applications a
    WHERE a.id = application_id AND a.user_id = auth.uid()
  ));

CREATE POLICY "Admins can insert reviews"
  ON public.cohost_application_reviews FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND reviewer_id = auth.uid());
