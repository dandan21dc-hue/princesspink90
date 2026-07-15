CREATE TABLE public.security_scans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  finding_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_scans TO authenticated;
GRANT ALL ON public.security_scans TO service_role;

ALTER TABLE public.security_scans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view security scans"
  ON public.security_scans FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert security scans"
  ON public.security_scans FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role) AND created_by = auth.uid());

CREATE POLICY "Admins can delete security scans"
  ON public.security_scans FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TABLE public.security_scan_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id uuid NOT NULL REFERENCES public.security_scans(id) ON DELETE CASCADE,
  scanned_at timestamptz NOT NULL DEFAULT now(),
  internal_id text NOT NULL,
  scanner_name text NOT NULL DEFAULT '',
  name text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT '',
  level text NOT NULL DEFAULT '',
  state text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX security_scan_findings_scan_id_idx ON public.security_scan_findings (scan_id);
CREATE INDEX security_scan_findings_internal_id_idx ON public.security_scan_findings (internal_id);
CREATE INDEX security_scan_findings_scanned_at_idx ON public.security_scan_findings (scanned_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.security_scan_findings TO authenticated;
GRANT ALL ON public.security_scan_findings TO service_role;

ALTER TABLE public.security_scan_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view security scan findings"
  ON public.security_scan_findings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert security scan findings"
  ON public.security_scan_findings FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete security scan findings"
  ON public.security_scan_findings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));