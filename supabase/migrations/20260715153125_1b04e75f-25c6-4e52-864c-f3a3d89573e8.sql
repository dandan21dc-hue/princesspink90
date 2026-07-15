
CREATE TABLE public.reward_point_reservations (
  order_id text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  points integer NOT NULL CHECK (points > 0),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','consumed','released')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.reward_point_reservations TO service_role;
ALTER TABLE public.reward_point_reservations ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role (server-only) touches this table.

CREATE INDEX reward_point_reservations_user_status_idx
  ON public.reward_point_reservations (user_id, status);

CREATE OR REPLACE FUNCTION public.reserve_reward_points(
  _order_id text, _user_id uuid, _points integer
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  available integer;
  reserved integer;
BEGIN
  IF _points IS NULL OR _points <= 0 THEN
    RAISE EXCEPTION 'points_must_be_positive';
  END IF;

  SELECT reward_points INTO available
    FROM public.profiles
    WHERE user_id = _user_id
    FOR UPDATE;
  IF available IS NULL THEN
    RAISE EXCEPTION 'profile_not_found';
  END IF;

  SELECT COALESCE(SUM(points), 0) INTO reserved
    FROM public.reward_point_reservations
    WHERE user_id = _user_id AND status = 'active';

  IF (available - reserved) < _points THEN
    RAISE EXCEPTION 'insufficient_reward_points';
  END IF;

  INSERT INTO public.reward_point_reservations(order_id, user_id, points)
    VALUES (_order_id, _user_id, _points)
    ON CONFLICT (order_id) DO NOTHING;

  RETURN TRUE;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.reserve_reward_points(text, uuid, integer) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.consume_reward_points_reservation(_order_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE r RECORD;
BEGIN
  SELECT * INTO r FROM public.reward_point_reservations
    WHERE order_id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN 0; END IF;
  IF r.status <> 'active' THEN RETURN 0; END IF;
  UPDATE public.profiles
    SET reward_points = GREATEST(0, reward_points - r.points)
    WHERE user_id = r.user_id;
  UPDATE public.reward_point_reservations
    SET status = 'consumed', updated_at = now()
    WHERE order_id = _order_id;
  RETURN r.points;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_reward_points_reservation(text) FROM PUBLIC;
