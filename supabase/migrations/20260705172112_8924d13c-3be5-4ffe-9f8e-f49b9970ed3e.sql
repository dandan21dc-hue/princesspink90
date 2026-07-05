
CREATE TABLE public.compliance_policy_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  accepted_by_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  policy_version_id UUID NOT NULL REFERENCES public.compliance_policy_versions(id) ON DELETE RESTRICT,
  policy_version_label TEXT NOT NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX compliance_policy_agreements_uniq
  ON public.compliance_policy_agreements (accepted_by_user_id, policy_version_id, COALESCE(event_id, '00000000-0000-0000-0000-000000000000'::uuid));

CREATE INDEX compliance_policy_agreements_user_idx
  ON public.compliance_policy_agreements (accepted_by_user_id, accepted_at DESC);

CREATE INDEX compliance_policy_agreements_event_idx
  ON public.compliance_policy_agreements (event_id);

GRANT SELECT, INSERT ON public.compliance_policy_agreements TO authenticated;
GRANT ALL ON public.compliance_policy_agreements TO service_role;

ALTER TABLE public.compliance_policy_agreements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users record their own agreements"
  ON public.compliance_policy_agreements FOR INSERT
  TO authenticated
  WITH CHECK (accepted_by_user_id = auth.uid());

CREATE POLICY "Users read their own agreements"
  ON public.compliance_policy_agreements FOR SELECT
  TO authenticated
  USING (accepted_by_user_id = auth.uid());

CREATE POLICY "Admins read all agreements"
  ON public.compliance_policy_agreements FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
