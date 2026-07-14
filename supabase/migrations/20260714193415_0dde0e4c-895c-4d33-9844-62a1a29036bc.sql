
-- External payment reference (e.g. NOWPayments invoice_id) — nullable to preserve existing rows
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS external_payment_reference text;

CREATE UNIQUE INDEX IF NOT EXISTS memberships_external_payment_reference_unique
  ON public.memberships (external_payment_reference)
  WHERE external_payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS memberships_user_active_term_pass_idx
  ON public.memberships (user_id, environment, expires_at)
  WHERE kind LIKE 'term_pass_%';

CREATE OR REPLACE FUNCTION public.grant_all_access_pass_30d(
  _user_id uuid,
  _environment text,
  _amount_cents integer,
  _external_payment_reference text
)
RETURNS public.memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing public.memberships;
  result public.memberships;
  new_expiry timestamptz;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;
  IF _environment IS NULL OR _environment NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'environment must be sandbox or live';
  END IF;

  -- Idempotency: if this external reference was already recorded, return that row.
  IF _external_payment_reference IS NOT NULL THEN
    SELECT * INTO existing
    FROM public.memberships
    WHERE external_payment_reference = _external_payment_reference
    LIMIT 1;
    IF FOUND THEN
      RETURN existing;
    END IF;
  END IF;

  -- Extend the most recent still-active All-Access pass, otherwise start fresh.
  SELECT * INTO existing
  FROM public.memberships
  WHERE user_id = _user_id
    AND environment = _environment
    AND kind = 'term_pass_all_access_30d'
    AND expires_at IS NOT NULL
    AND expires_at > now()
  ORDER BY expires_at DESC
  LIMIT 1;

  IF FOUND THEN
    new_expiry := existing.expires_at + interval '30 days';
    UPDATE public.memberships
       SET expires_at = new_expiry,
           amount_cents = COALESCE(_amount_cents, amount_cents),
           external_payment_reference = COALESCE(_external_payment_reference, external_payment_reference),
           updated_at = now()
     WHERE id = existing.id
    RETURNING * INTO result;
  ELSE
    INSERT INTO public.memberships (
      user_id, kind, environment, amount_cents, expires_at, term_months, external_payment_reference
    ) VALUES (
      _user_id,
      'term_pass_all_access_30d',
      _environment,
      _amount_cents,
      now() + interval '30 days',
      1,
      _external_payment_reference
    )
    RETURNING * INTO result;
  END IF;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_all_access_pass_30d(uuid, text, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.grant_all_access_pass_30d(uuid, text, integer, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_all_access_pass_30d(uuid, text, integer, text) TO service_role;
