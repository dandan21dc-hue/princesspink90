
-- Idempotency helpers: reuse memberships.external_payment_reference (already unique)
-- and panty_orders.external_payment_reference (unique per earlier migration).

-- =========================================================================
-- Lifetime membership grant. Idempotent per external payment reference.
-- =========================================================================
CREATE OR REPLACE FUNCTION public.grant_lifetime_membership(
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
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;
  IF _environment IS NULL OR _environment NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'environment must be sandbox or live';
  END IF;

  -- Idempotency: same external reference → return existing row.
  IF _external_payment_reference IS NOT NULL THEN
    SELECT * INTO existing
    FROM public.memberships
    WHERE external_payment_reference = _external_payment_reference
    LIMIT 1;
    IF FOUND THEN
      RETURN existing;
    END IF;
  END IF;

  -- If the user already has a lifetime row in this environment, return it.
  SELECT * INTO existing
  FROM public.memberships
  WHERE user_id = _user_id
    AND environment = _environment
    AND kind = 'lifetime'
  LIMIT 1;
  IF FOUND THEN
    UPDATE public.memberships
       SET amount_cents = COALESCE(_amount_cents, amount_cents),
           external_payment_reference = COALESCE(external_payment_reference, _external_payment_reference),
           updated_at = now()
     WHERE id = existing.id
    RETURNING * INTO result;
    RETURN result;
  END IF;

  INSERT INTO public.memberships (
    user_id, kind, environment, amount_cents, expires_at, external_payment_reference
  ) VALUES (
    _user_id,
    'lifetime',
    _environment,
    _amount_cents,
    NULL,  -- lifetime never expires
    _external_payment_reference
  )
  RETURNING * INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_lifetime_membership(uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_lifetime_membership(uuid, text, integer, text) TO service_role;

-- =========================================================================
-- Panty listing order grant. Records the order + marks the listing sold.
-- Idempotent per external_payment_reference (unique on panty_orders).
-- =========================================================================
CREATE OR REPLACE FUNCTION public.grant_panty_listing_order(
  _user_id uuid,
  _panty_listing_id uuid,
  _environment text,
  _amount_cents integer,
  _external_payment_reference text
)
RETURNS public.panty_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  existing public.panty_orders;
  listing public.panty_listings;
  result public.panty_orders;
  v_variant text;
  v_hours integer;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user_id is required';
  END IF;
  IF _panty_listing_id IS NULL THEN
    RAISE EXCEPTION 'panty_listing_id is required';
  END IF;
  IF _environment IS NULL OR _environment NOT IN ('sandbox','live') THEN
    RAISE EXCEPTION 'environment must be sandbox or live';
  END IF;

  -- Idempotency: same NOWPayments payment_id → return existing order row.
  IF _external_payment_reference IS NOT NULL THEN
    SELECT * INTO existing
    FROM public.panty_orders
    WHERE external_payment_reference = _external_payment_reference
    LIMIT 1;
    IF FOUND THEN
      RETURN existing;
    END IF;
  END IF;

  SELECT * INTO listing
  FROM public.panty_listings
  WHERE id = _panty_listing_id
  LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'panty listing % not found', _panty_listing_id;
  END IF;

  -- Individual listings don't carry a wear-hours field, so pick a
  -- neutral default. The `variant` column has a CHECK constraint, so
  -- pick the closest matching variant based on price bands (48hr as a
  -- safe middle default when unknown).
  v_hours := 48;
  v_variant := 'panty_48hr_aud';

  INSERT INTO public.panty_orders (
    user_id, variant, hours, external_payment_reference,
    amount_cents, currency, environment, status,
    panty_listing_id
  ) VALUES (
    _user_id, v_variant, v_hours, _external_payment_reference,
    _amount_cents, COALESCE(listing.currency, 'aud'), _environment, 'paid',
    _panty_listing_id
  )
  RETURNING * INTO result;

  -- Mark the listing sold so it no longer appears buyable.
  UPDATE public.panty_listings
     SET sold = true, updated_at = now()
   WHERE id = _panty_listing_id;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_panty_listing_order(uuid, uuid, text, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_panty_listing_order(uuid, uuid, text, integer, text) TO service_role;
