CREATE OR REPLACE FUNCTION public.validate_referral_code(_code text, _email text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  norm text := upper(btrim(coalesce(_code, '')));
  norm_email text := lower(btrim(coalesce(_email, '')));
  owner_id uuid;
  self_owner_id uuid;
BEGIN
  IF norm = '' THEN
    RETURN jsonb_build_object('exists', false, 'is_self', false);
  END IF;

  SELECT user_id INTO owner_id
  FROM public.profiles
  WHERE upper(referral_code) = norm
  LIMIT 1;

  IF owner_id IS NULL THEN
    RETURN jsonb_build_object('exists', false, 'is_self', false);
  END IF;

  IF norm_email <> '' THEN
    SELECT id INTO self_owner_id
    FROM auth.users
    WHERE lower(email) = norm_email
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'exists', true,
    'is_self', (self_owner_id IS NOT NULL AND self_owner_id = owner_id)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.validate_referral_code(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.validate_referral_code(text, text) TO anon, authenticated, service_role;