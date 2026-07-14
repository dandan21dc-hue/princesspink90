REVOKE EXECUTE ON FUNCTION public.search_admin_audit_ids(text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_admin_audit_ids(text) TO authenticated;