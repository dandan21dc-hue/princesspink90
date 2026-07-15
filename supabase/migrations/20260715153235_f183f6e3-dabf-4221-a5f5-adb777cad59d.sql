
REVOKE EXECUTE ON FUNCTION public.reserve_reward_points(text, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_reward_points_reservation(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_reward_points(text, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_reward_points_reservation(text) TO service_role;
