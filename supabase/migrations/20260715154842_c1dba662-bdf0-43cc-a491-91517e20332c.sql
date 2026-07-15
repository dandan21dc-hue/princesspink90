CREATE TABLE public.security_changelog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_changelog TO authenticated;
GRANT ALL ON public.security_changelog TO service_role;

ALTER TABLE public.security_changelog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read security changelog"
  ON public.security_changelog FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins insert security changelog"
  ON public.security_changelog FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins update security changelog"
  ON public.security_changelog FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins delete security changelog"
  ON public.security_changelog FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX security_changelog_version_desc_idx
  ON public.security_changelog (version DESC);

CREATE TRIGGER security_changelog_touch_updated_at
  BEFORE UPDATE ON public.security_changelog
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();