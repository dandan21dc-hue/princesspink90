-- 1. Columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS reward_points integer NOT NULL DEFAULT 0;

-- Case-insensitive unique index on referral_code
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_key
  ON public.profiles (upper(referral_code))
  WHERE referral_code IS NOT NULL;

-- 2. Referral code generator: 6 chars, uppercase, no confusable chars.
CREATE OR REPLACE FUNCTION public.generate_referral_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I
  code text;
  i int;
  attempts int := 0;
BEGIN
  LOOP
    code := '';
    FOR i IN 1..6 LOOP
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.profiles WHERE upper(referral_code) = code
    );
    attempts := attempts + 1;
    IF attempts > 50 THEN
      RAISE EXCEPTION 'Could not generate a unique referral code after 50 attempts';
    END IF;
  END LOOP;
  RETURN code;
END;
$$;

-- 3. BEFORE INSERT trigger on profiles to auto-assign a code if missing.
CREATE OR REPLACE FUNCTION public.profiles_assign_referral_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.referral_code IS NULL OR btrim(NEW.referral_code) = '' THEN
    NEW.referral_code := public.generate_referral_code();
  ELSE
    NEW.referral_code := upper(btrim(NEW.referral_code));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_assign_referral_code_trigger ON public.profiles;
CREATE TRIGGER profiles_assign_referral_code_trigger
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.profiles_assign_referral_code();

-- 4. Backfill existing profiles.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT user_id FROM public.profiles WHERE referral_code IS NULL LOOP
    UPDATE public.profiles SET referral_code = public.generate_referral_code() WHERE user_id = r.user_id;
  END LOOP;
END $$;

-- 5. Extend handle_new_user to award 50 points to referrer when raw_user_meta_data.referral_code matches.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ref_code text;
  ref_user uuid;
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
      UPDATE public.profiles
         SET reward_points = reward_points + 50
       WHERE user_id = ref_user;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;