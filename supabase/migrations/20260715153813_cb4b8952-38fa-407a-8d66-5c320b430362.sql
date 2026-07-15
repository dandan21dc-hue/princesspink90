
-- rewards_catalog -----------------------------------------------------------
CREATE TABLE public.rewards_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  image_url text,
  points_cost integer NOT NULL CHECK (points_cost > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rewards_catalog TO authenticated;
GRANT ALL ON public.rewards_catalog TO service_role;
ALTER TABLE public.rewards_catalog ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated read active rewards"
  ON public.rewards_catalog FOR SELECT
  TO authenticated
  USING (is_active = true OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins insert rewards"
  ON public.rewards_catalog FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins update rewards"
  ON public.rewards_catalog FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "admins delete rewards"
  ON public.rewards_catalog FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER rewards_catalog_touch_updated_at
  BEFORE UPDATE ON public.rewards_catalog
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- user_rewards --------------------------------------------------------------
CREATE TABLE public.user_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reward_id uuid NOT NULL REFERENCES public.rewards_catalog(id) ON DELETE RESTRICT,
  reward_name text NOT NULL,
  points_spent integer NOT NULL CHECK (points_spent >= 0),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','fulfilled','cancelled')),
  fulfilled_at timestamptz,
  fulfilled_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_rewards TO authenticated;
GRANT ALL ON public.user_rewards TO service_role;
ALTER TABLE public.user_rewards ENABLE ROW LEVEL SECURITY;

CREATE INDEX user_rewards_user_created_idx ON public.user_rewards (user_id, created_at DESC);
CREATE INDEX user_rewards_status_idx ON public.user_rewards (status, created_at DESC);

CREATE POLICY "users read own redemptions"
  ON public.user_rewards FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

-- Admins update (fulfill/cancel). Users don't self-update — redemption is
-- created via the redeem_reward RPC.
CREATE POLICY "admins update redemptions"
  ON public.user_rewards FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER user_rewards_touch_updated_at
  BEFORE UPDATE ON public.user_rewards
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- redeem_reward RPC ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.redeem_reward(_reward_id uuid)
RETURNS public.user_rewards
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  caller uuid := auth.uid();
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

  -- Respect any active checkout reservations so users can't redeem points
  -- they've already earmarked for a pending crypto invoice.
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
$$;
REVOKE EXECUTE ON FUNCTION public.redeem_reward(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_reward(uuid) TO authenticated;
