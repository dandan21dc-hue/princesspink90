
ALTER TABLE public.admin_activity_audit
  ALTER COLUMN entry_hash SET DEFAULT '',
  ALTER COLUMN prev_hash SET DEFAULT '';

REVOKE ALL ON FUNCTION public.verify_admin_activity_audit_integrity() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.verify_admin_activity_audit_integrity() TO service_role;

REVOKE ALL ON FUNCTION public.admin_activity_audit_chain() FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_activity_audit_chain() TO service_role;
