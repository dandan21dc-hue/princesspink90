-- Safeguard: ensure a referred user can only ever generate ONE referral
-- reward for their referrer, even if handle_new_user() runs twice
-- (retried signup, trigger re-fire, manual profile re-insert, etc.).

CREATE TABLE IF NOT EXISTS public.referral_reward_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referred_user_id uuid NOT NULL UNIQUE,
  referrer_user_id uuid NOT NULL,
  points_awarded integer NOT NULL,
  referral_code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.referral_reward_grants TO authenticated;
GRANT ALL ON public.referral_reward_grants TO service_role;

ALTER TABLE public.referral_reward_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own referral rewards"
  ON public.referral_reward_grants
  FOR SELECT
  TO authenticated
  USING (auth.uid() = referrer_user_id OR auth.uid() = referred_user_id);

CREATE POLICY "Admins can view all referral rewards"
  ON public.referral_reward_grants
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS referral_reward_grants_referrer_idx
  ON public.referral_reward_grants(referrer_user_id);

-- Rewrite handle_new_user() so the referral bonus is gated by an
-- idempotent insert into referral_reward_grants. The UNIQUE constraint
-- on referred_user_id guarantees at most one bonus per referred user;
-- ON CONFLICT DO NOTHING makes replays a no-op and the points update
-- only runs when a NEW grant row was actually created.
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  ref_code text;
  ref_user uuid;
  granted_id uuid;
  bonus_points constant integer := 50;
BEGIN
  INSERT INTO public.profiles (user_id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  ref_code := upper(btrim(COALESCE(NEW.raw_user_meta_data->>'referral_code', '')));
  IF ref_code <> '' THEN
    SELECT user_id INTO ref_user
    FROM public.profiles
    WHERE upper(referral_code) = ref_code
      AND user_id <> NEW.id
    LIMIT 1;

    IF ref_user IS NOT NULL THEN
      -- Idempotent: unique(referred_user_id) makes retries a no-op.
      INSERT INTO public.referral_reward_grants
        (referred_user_id, referrer_user_id, points_awarded, referral_code)
      VALUES (NEW.id, ref_user, bonus_points, ref_code)
      ON CONFLICT (referred_user_id) DO NOTHING
      RETURNING id INTO granted_id;

      IF granted_id IS NOT NULL THEN
        UPDATE public.profiles
           SET reward_points = reward_points + bonus_points
         WHERE user_id = ref_user;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;