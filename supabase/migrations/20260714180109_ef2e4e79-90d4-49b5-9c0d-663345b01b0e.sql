REVOKE EXECUTE ON FUNCTION public.run_payment_integrity_checks() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_payment_integrity_schedule() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_payment_integrity_schedule(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_payment_integrity_checks() TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_payment_integrity_schedule() TO service_role;
GRANT EXECUTE ON FUNCTION public.update_payment_integrity_schedule(text, text) TO service_role;