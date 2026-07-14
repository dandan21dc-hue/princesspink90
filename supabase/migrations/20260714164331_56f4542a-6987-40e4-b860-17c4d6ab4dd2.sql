
REVOKE EXECUTE ON FUNCTION public.purge_expired_admin_activity_audit() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_expired_admin_activity_audit() FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_expired_admin_activity_audit() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_admin_activity_audit() TO service_role;
