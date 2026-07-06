ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age_gate_confirmed_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.has_age_verification(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = _user_id AND age_gate_confirmed_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1 FROM public.age_verifications
    WHERE user_id = _user_id AND status = 'approved'
  );
$$;

REVOKE EXECUTE ON FUNCTION public.has_age_verification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_age_verification(uuid) TO authenticated;