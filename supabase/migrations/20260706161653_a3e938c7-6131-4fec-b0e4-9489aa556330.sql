REVOKE EXECUTE ON FUNCTION public.has_age_verification(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_private_room_busy(timestamptz, timestamptz) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_age_verification(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.get_private_room_busy(timestamptz, timestamptz) TO service_role;