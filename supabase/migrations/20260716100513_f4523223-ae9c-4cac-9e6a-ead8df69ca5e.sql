
-- 1) Dynamic reward multiplier on site_settings singleton
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS points_per_dollar_multiplier numeric(10,2) NOT NULL DEFAULT 1;

ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_points_multiplier_nonneg
  CHECK (points_per_dollar_multiplier >= 0 AND points_per_dollar_multiplier <= 1000);

-- 2) Idempotent audit ledger of points awarded per purchase
CREATE TABLE IF NOT EXISTS public.purchase_reward_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source text NOT NULL,
  external_payment_reference text NOT NULL UNIQUE,
  amount_cents integer NOT NULL,
  multiplier numeric(10,2) NOT NULL,
  points_awarded integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.purchase_reward_grants TO authenticated;
GRANT ALL ON public.purchase_reward_grants TO service_role;

ALTER TABLE public.purchase_reward_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own purchase reward grants"
  ON public.purchase_reward_grants
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX IF NOT EXISTS purchase_reward_grants_user_created_idx
  ON public.purchase_reward_grants(user_id, created_at DESC);

-- 3) Idempotent RPC that awards purchase points using the dynamic multiplier
CREATE OR REPLACE FUNCTION public.grant_purchase_reward_points(
  _user_id uuid,
  _amount_cents integer,
  _external_payment_reference text,
  _source text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  mult numeric;
  pts integer;
  inserted_id uuid;
BEGIN
  IF _user_id IS NULL OR _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN 0;
  END IF;
  IF _external_payment_reference IS NULL OR btrim(_external_payment_reference) = '' THEN
    RETURN 0;
  END IF;

  SELECT points_per_dollar_multiplier INTO mult
    FROM public.site_settings WHERE id = 'host' LIMIT 1;
  mult := COALESCE(mult, 1);

  pts := floor((_amount_cents::numeric / 100.0) * mult)::integer;
  IF pts <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.purchase_reward_grants
    (user_id, source, external_payment_reference, amount_cents, multiplier, points_awarded)
  VALUES
    (_user_id, COALESCE(_source, 'purchase'), _external_payment_reference, _amount_cents, mult, pts)
  ON CONFLICT (external_payment_reference) DO NOTHING
  RETURNING id INTO inserted_id;

  IF inserted_id IS NULL THEN
    RETURN 0; -- already granted for this payment (idempotent replay)
  END IF;

  UPDATE public.profiles
     SET reward_points = reward_points + pts
   WHERE user_id = _user_id;

  RETURN pts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_purchase_reward_points(uuid, integer, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_purchase_reward_points(uuid, integer, text, text) TO service_role;
