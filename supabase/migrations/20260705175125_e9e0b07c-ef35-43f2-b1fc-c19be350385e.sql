
REVOKE EXECUTE ON FUNCTION public.purge_expired_health_screenings() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.purge_expired_health_screenings() FROM anon;
REVOKE EXECUTE ON FUNCTION public.purge_expired_health_screenings() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_health_screenings() TO service_role;
