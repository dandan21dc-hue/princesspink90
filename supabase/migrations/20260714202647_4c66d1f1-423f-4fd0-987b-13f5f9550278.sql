CREATE OR REPLACE FUNCTION public.grant_all_access_pass_30d(
  _user_id uuid,
  _environment text,
  _amount_cents integer,
  _external_payment_reference text
)
RETURNS memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing public.memberships;
  result public.memberships;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;
  IF _environment IS NULL OR _environment NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'environment must be sandbox or live';
  END IF;

  -- Idempotency: replayed webhook for the same payment returns the original row
  -- without ever extending the window.
  IF _external_payment_reference IS NOT NULL THEN
    SELECT * INTO existing
    FROM public.memberships
    WHERE external_payment_reference = _external_payment_reference
    LIMIT 1;
    IF FOUND THEN
      RETURN existing;
    END IF;
  END IF;

  -- Single time-based entitlement: refresh the user's most recent 30-day pass
  -- to a fresh 30-day window from now. No stacking, no auto-renewal — after
  -- expires_at the user must buy again to regain access.
  SELECT * INTO existing
  FROM public.memberships
  WHERE user_id = _user_id
    AND environment = _environment
    AND kind = 'term_pass_all_access_30d'
  ORDER BY expires_at DESC NULLS LAST, created_at DESC
  LIMIT 1;

  IF FOUND THEN
    UPDATE public.memberships
       SET expires_at = now() + interval '30 days',
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
$function$;