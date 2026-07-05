
CREATE TABLE public.compliance_policy_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version TEXT NOT NULL UNIQUE,
  effective_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  summary TEXT NOT NULL,
  body TEXT NOT NULL,
  is_current BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.compliance_policy_versions TO anon, authenticated;
GRANT INSERT, UPDATE ON public.compliance_policy_versions TO authenticated;
GRANT ALL ON public.compliance_policy_versions TO service_role;

ALTER TABLE public.compliance_policy_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read policy versions"
  ON public.compliance_policy_versions FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert policy versions"
  ON public.compliance_policy_versions FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update policy versions"
  ON public.compliance_policy_versions FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Enforce a single current version.
CREATE UNIQUE INDEX compliance_policy_versions_one_current
  ON public.compliance_policy_versions ((is_current)) WHERE is_current;

CREATE TRIGGER compliance_policy_versions_touch
  BEFORE UPDATE ON public.compliance_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed initial version.
INSERT INTO public.compliance_policy_versions (version, summary, body, is_current)
VALUES (
  '1.0',
  'Initial venue & event compliance policy: permits, liability insurance, and capacity documentation required before publishing.',
  'Hosts must upload a valid event permit, a liability insurance certificate that covers the event date, and a venue capacity certificate. Documents must be legible PDFs or images. See /compliance for the full policy.',
  true
);

-- Track which policy version each compliance document was uploaded against.
ALTER TABLE public.event_documents
  ADD COLUMN policy_version_id UUID REFERENCES public.compliance_policy_versions(id),
  ADD COLUMN policy_version_label TEXT;
