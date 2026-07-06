REVOKE EXECUTE ON FUNCTION public.list_accounts_to_purge() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.purge_account_rows(uuid) FROM anon, authenticated, public;
GRANT EXECUTE ON FUNCTION public.list_accounts_to_purge() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_account_rows(uuid) TO service_role;