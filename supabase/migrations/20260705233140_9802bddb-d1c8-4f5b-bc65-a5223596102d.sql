-- Tighten EXECUTE grants on SECURITY DEFINER RPCs
REVOKE EXECUTE ON FUNCTION public.get_private_room_busy(timestamptz, timestamptz) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.go_live_status() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cron_health_snapshot() FROM anon, authenticated, PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_private_room_busy(timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.go_live_status() TO service_role;
GRANT EXECUTE ON FUNCTION public.cron_health_snapshot() TO service_role;