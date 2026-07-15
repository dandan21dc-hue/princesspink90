-- Lock down overprivileged EXECUTE grants on SECURITY DEFINER functions
-- exposed in the public schema.

REVOKE EXECUTE ON FUNCTION public.admin_find_user_ids_by_email(_email_pattern text)
  FROM anon, authenticated, PUBLIC;

REVOKE EXECUTE ON FUNCTION public.search_admin_audit_ids(_q text)
  FROM authenticated, PUBLIC;
