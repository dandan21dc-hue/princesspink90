
CREATE OR REPLACE FUNCTION public.grant_all_access_pass_term(
  _user_id uuid,
  _environment text,
  _amount_cents integer,
  _external_payment_reference text,
  _days integer
)
RETURNS memberships
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  existing public.memberships;
  result public.memberships;
  kind_name text;
BEGIN
  IF _user_id IS NULL THEN RAISE EXCEPTION 'user_id is required'; END IF;
  IF _environment IS NULL OR _environment NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'environment must be sandbox or live';
  END IF;
  IF _days IS NULL OR _days NOT IN (90, 180, 365) THEN
    RAISE EXCEPTION '_days must be 90, 180, or 365';
  END IF;

  kind_name := 'term_pass_all_access_' || _days || 'd';

  IF _external_payment_reference IS NOT NULL THEN
    SELECT * INTO existing FROM public.memberships
      WHERE external_payment_reference = _external_payment_reference LIMIT 1;
    IF FOUND THEN RETURN existing; END IF;
  END IF;

  SELECT * INTO existing FROM public.memberships
    WHERE user_id = _user_id AND environment = _environment AND kind = kind_name
    ORDER BY expires_at DESC NULLS LAST, created_at DESC LIMIT 1;

  IF FOUND THEN
    UPDATE public.memberships
       SET expires_at = now() + (_days || ' days')::interval,
           amount_cents = COALESCE(_amount_cents, amount_cents),
           external_payment_reference = COALESCE(_external_payment_reference, external_payment_reference),
           updated_at = now()
     WHERE id = existing.id
    RETURNING * INTO result;
  ELSE
    INSERT INTO public.memberships (
      user_id, kind, environment, amount_cents, expires_at, term_months, external_payment_reference
    ) VALUES (
      _user_id, kind_name, _environment, _amount_cents,
      now() + (_days || ' days')::interval,
      CASE _days WHEN 90 THEN 3 WHEN 180 THEN 6 WHEN 365 THEN 12 END,
      _external_payment_reference
    )
    RETURNING * INTO result;
  END IF;

  RETURN result;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.grant_all_access_pass_term(uuid, text, integer, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_all_access_pass_term(uuid, text, integer, text, integer) TO service_role;
