
CREATE OR REPLACE FUNCTION public.revoke_entitlement_by_payment_reference(
  _reference text,
  _mode text,
  _reason text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  affected jsonb := '[]'::jsonb;
  m_row public.memberships;
  p_row public.panty_orders;
  b_row public.private_room_bookings;
BEGIN
  IF _reference IS NULL OR btrim(_reference) = '' THEN
    RAISE EXCEPTION 'reference required';
  END IF;
  IF _mode NOT IN ('revoked','suspended') THEN
    RAISE EXCEPTION 'mode must be revoked or suspended';
  END IF;

  SELECT * INTO m_row FROM public.memberships
   WHERE external_payment_reference = _reference LIMIT 1;
  IF FOUND THEN
    IF _mode = 'revoked' THEN
      UPDATE public.memberships
         SET revoked_at = COALESCE(revoked_at, now()),
             revocation_reason = COALESCE(_reason, revocation_reason),
             expires_at = CASE
               WHEN kind LIKE 'term_pass_%' AND (expires_at IS NULL OR expires_at > now())
                 THEN now()
               ELSE expires_at
             END,
             updated_at = now()
       WHERE id = m_row.id;
    ELSE
      UPDATE public.memberships
         SET suspended_at = COALESCE(suspended_at, now()),
             revocation_reason = COALESCE(_reason, revocation_reason),
             updated_at = now()
       WHERE id = m_row.id;
    END IF;
    affected := affected || jsonb_build_object(
      'kind', 'membership',
      'id', m_row.id,
      'membership_kind', m_row.kind,
      'user_id', m_row.user_id,
      'environment', m_row.environment
    );
  END IF;

  SELECT * INTO p_row FROM public.panty_orders
   WHERE external_payment_reference = _reference LIMIT 1;
  IF FOUND THEN
    UPDATE public.panty_orders
       SET status = CASE WHEN _mode = 'revoked' THEN 'refunded' ELSE 'disputed' END,
           updated_at = now()
     WHERE id = p_row.id
       AND status NOT IN ('refunded','disputed','canceled');
    IF _mode = 'revoked' AND p_row.panty_listing_id IS NOT NULL THEN
      UPDATE public.panty_listings SET sold = false, updated_at = now()
       WHERE id = p_row.panty_listing_id;
    END IF;
    affected := affected || jsonb_build_object(
      'kind', 'panty_order',
      'id', p_row.id,
      'user_id', p_row.user_id
    );
  END IF;

  SELECT * INTO b_row FROM public.private_room_bookings
   WHERE external_payment_reference = _reference LIMIT 1;
  IF FOUND THEN
    UPDATE public.private_room_bookings
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = b_row.id
       AND status <> 'cancelled';
    affected := affected || jsonb_build_object(
      'kind', 'private_room_booking',
      'id', b_row.id,
      'mode', _mode,
      'user_id', b_row.user_id
    );
  END IF;

  RETURN jsonb_build_object(
    'reference', _reference,
    'mode', _mode,
    'reason', _reason,
    'affected', affected,
    'affected_count', jsonb_array_length(affected)
  );
END;
$function$;
