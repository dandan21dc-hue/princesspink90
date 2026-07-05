
-- Defense-in-depth: strip anon access entirely; RLS already restricts to admins,
-- but there is no reason anon should ever reach these tables.
REVOKE ALL ON public.safety_incident_reports FROM anon;
REVOKE ALL ON public.safety_incident_attachments FROM anon;

-- Reports: authenticated may SELECT/INSERT/UPDATE (RLS admin-gated); DELETE was
-- previously revoked to keep the audit trail immutable — preserve that.
REVOKE ALL ON public.safety_incident_reports FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.safety_incident_reports TO authenticated;

-- Attachments: authenticated may SELECT/INSERT/DELETE (RLS admin-gated).
-- No UPDATE path is used or wanted for attachment metadata.
REVOKE ALL ON public.safety_incident_attachments FROM authenticated;
GRANT SELECT, INSERT, DELETE ON public.safety_incident_attachments TO authenticated;

-- Ensure service_role retains full access for admin/edge paths.
GRANT ALL ON public.safety_incident_reports TO service_role;
GRANT ALL ON public.safety_incident_attachments TO service_role;
