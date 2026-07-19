-- Enforce immutability of signed compliance records at the privilege level.
-- RLS already denies UPDATE/DELETE (no permissive policies exist), but
-- revoking the table privileges makes the intent explicit and prevents any
-- future permissive policy from accidentally allowing mutation.
REVOKE UPDATE, DELETE ON public.compliance_policy_agreements FROM authenticated, anon;
REVOKE UPDATE, DELETE ON public.waiver_audit_log FROM authenticated, anon;

-- Service role retains full access for admin/backfill workflows.
GRANT ALL ON public.compliance_policy_agreements TO service_role;
GRANT ALL ON public.waiver_audit_log TO service_role;