-- Add optional trusted caller parameter so server can invoke via service_role
CREATE OR REPLACE FUNCTION public.redeem_reward(_reward_id uuid, _caller uuid DEFAULT NULL)
RETURNS public.user_rewards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  caller uuid := COALESCE(_caller, auth.uid());
  reward public.rewards_catalog;
  available integer;
  reserved integer;
  redemption public.user_rewards;
BEGIN
  IF caller IS NULL THEN
    RAISE EXCEPTION 'auth_required';
  END IF;

  SELECT * INTO reward
    FROM public.rewards_catalog
    WHERE id = _reward_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reward_not_found';
  END IF;
  IF NOT reward.is_active THEN
    RAISE EXCEPTION 'reward_inactive';
  END IF;

  SELECT reward_points INTO available
    FROM public.profiles
    WHERE user_id = caller
    FOR UPDATE;
  IF available IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO reserved
    FROM public.reward_point_reservations
    WHERE user_id = caller AND status = 'active';

  IF (available - reserved) < reward.points_cost THEN
    RAISE EXCEPTION 'insufficient_reward_points';
  END IF;

  UPDATE public.profiles
     SET reward_points = reward_points - reward.points_cost
   WHERE user_id = caller;

  INSERT INTO public.user_rewards(user_id, reward_id, reward_name, points_spent, status)
    VALUES (caller, reward.id, reward.name, reward.points_cost, 'pending')
    RETURNING * INTO redemption;

  RETURN redemption;
END;
$function$;

-- Revoke public execute; only service_role should invoke these
REVOKE EXECUTE ON FUNCTION public.redeem_reward(uuid) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.redeem_reward(uuid, uuid) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_reward(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.validate_referral_code(text, text) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_referral_code(text, text) TO service_role;