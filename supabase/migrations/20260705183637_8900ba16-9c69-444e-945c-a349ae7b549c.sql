CREATE TABLE IF NOT EXISTS public.venue_compliance_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL CHECK (action IN ('uploaded','updated','deleted','summary_generated')),
  document_id uuid,
  document_title text,
  document_kind text,
  actor_id uuid NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.venue_compliance_audit_log TO authenticated;
GRANT ALL ON public.venue_compliance_audit_log TO service_role;

ALTER TABLE public.venue_compliance_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view venue compliance audit"
  ON public.venue_compliance_audit_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert venue compliance audit"
  ON public.venue_compliance_audit_log
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND actor_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_vcal_created_at ON public.venue_compliance_audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_vcal_document ON public.venue_compliance_audit_log(document_id);