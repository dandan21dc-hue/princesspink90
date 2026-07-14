CREATE TABLE public.admin_activity_audit_quarantine (
  audit_id uuid PRIMARY KEY REFERENCES public.admin_activity_audit(id) ON DELETE CASCADE,
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  quarantined_by uuid NOT NULL,
  reason text
);
GRANT SELECT, INSERT, DELETE ON public.admin_activity_audit_quarantine TO authenticated;
GRANT ALL ON public.admin_activity_audit_quarantine TO service_role;
ALTER TABLE public.admin_activity_audit_quarantine ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view quarantine markers"
  ON public.admin_activity_audit_quarantine FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "Admins can add quarantine markers"
  ON public.admin_activity_audit_quarantine FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    AND quarantined_by = auth.uid()
  );
CREATE POLICY "Admins can clear quarantine markers"
  ON public.admin_activity_audit_quarantine FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX idx_admin_activity_audit_quarantine_at
  ON public.admin_activity_audit_quarantine (quarantined_at DESC);