
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS revocation_reason text;

CREATE INDEX IF NOT EXISTS idx_memberships_revoked_at ON public.memberships(revoked_at) WHERE revoked_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_memberships_suspended_at ON public.memberships(suspended_at) WHERE suspended_at IS NOT NULL;

-- Extend tamper guard: revoked/suspended/reason cannot be moved by regular users.
CREATE OR REPLACE FUNCTION public.memberships_block_user_field_tamper()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.environment IS DISTINCT FROM OLD.environment
       OR NEW.private_session_bundle_id IS DISTINCT FROM OLD.private_session_bundle_id
       OR NEW.private_session_bundle_granted_at IS DISTINCT FROM OLD.private_session_bundle_granted_at
       OR NEW.user_id IS DISTINCT FROM OLD.user_id
       OR NEW.event_ticket_used_at IS DISTINCT FROM OLD.event_ticket_used_at
       OR NEW.event_ticket_event_id IS DISTINCT FROM OLD.event_ticket_event_id
       OR NEW.private_session_requested_at IS DISTINCT FROM OLD.private_session_requested_at
       OR NEW.private_session_fulfilled_at IS DISTINCT FROM OLD.private_session_fulfilled_at
       OR NEW.revoked_at IS DISTINCT FROM OLD.revoked_at
       OR NEW.suspended_at IS DISTINCT FROM OLD.suspended_at
       OR NEW.revocation_reason IS DISTINCT FROM OLD.revocation_reason THEN
      RAISE EXCEPTION 'Membership billing and perk fields can only be modified by staff or server processes';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- Update content-access predicate to exclude revoked / suspended memberships.
CREATE OR REPLACE FUNCTION public.user_can_access_content(_user_id uuid, _content_id uuid, _env text DEFAULT 'sandbox'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _user_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.content_purchases
        WHERE user_id = _user_id
          AND content_item_id = _content_id
          AND environment = _env
      )
      OR EXISTS (
        SELECT 1 FROM public.memberships
        WHERE user_id = _user_id
          AND environment = _env
          AND revoked_at IS NULL
          AND suspended_at IS NULL
          AND (
            kind = 'lifetime'
            OR (kind LIKE 'term_pass_%' AND expires_at IS NOT NULL AND expires_at > now())
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.memberships
        WHERE user_id = _user_id
          AND environment = _env
          AND private_session_bundle_id = _content_id
          AND private_session_bundle_granted_at IS NOT NULL
          AND revoked_at IS NULL
          AND suspended_at IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.content_items ci
        WHERE ci.id = _content_id AND ci.creator_id = _user_id
      )
    );
$function$;

-- Revocation RPC — used by the NOWPayments webhook when a payment is refunded
-- or charged back. Idempotent: re-runs update the reason/timestamps to the
-- most recent event but never resurrect an already-revoked/suspended row.
CREATE OR REPLACE FUNCTION public.revoke_entitlement_by_payment_reference(
  _reference text,
  _mode text,           -- 'revoked' or 'suspended'
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

  -- Memberships: unique on external_payment_reference.
  SELECT * INTO m_row FROM public.memberships
   WHERE external_payment_reference = _reference LIMIT 1;
  IF FOUND THEN
    IF _mode = 'revoked' THEN
      UPDATE public.memberships
         SET revoked_at = COALESCE(revoked_at, now()),
             revocation_reason = COALESCE(_reason, revocation_reason),
             -- Immediately kill any time-based pass so downstream checks that
             -- read only expires_at also lose access.
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
    affected := affected || jsonb_build_object('kind', 'membership', 'id', m_row.id, 'membership_kind', m_row.kind);
  END IF;

  -- Panty orders: unique on external_payment_reference.
  SELECT * INTO p_row FROM public.panty_orders
   WHERE external_payment_reference = _reference LIMIT 1;
  IF FOUND THEN
    UPDATE public.panty_orders
       SET status = CASE WHEN _mode = 'revoked' THEN 'refunded' ELSE 'disputed' END,
           updated_at = now()
     WHERE id = p_row.id
       AND status NOT IN ('refunded','disputed','canceled');
    -- Also unmark the listing so it can be relisted after a refund.
    IF _mode = 'revoked' AND p_row.panty_listing_id IS NOT NULL THEN
      UPDATE public.panty_listings SET sold = false, updated_at = now()
       WHERE id = p_row.panty_listing_id;
    END IF;
    affected := affected || jsonb_build_object('kind', 'panty_order', 'id', p_row.id);
  END IF;

  -- Private room bookings: unique on external_payment_reference.
  SELECT * INTO b_row FROM public.private_room_bookings
   WHERE external_payment_reference = _reference LIMIT 1;
  IF FOUND THEN
    -- The booking status CHECK only allows pending/confirmed/cancelled.
    UPDATE public.private_room_bookings
       SET status = 'cancelled',
           updated_at = now()
     WHERE id = b_row.id
       AND status <> 'cancelled';
    affected := affected || jsonb_build_object('kind', 'private_room_booking', 'id', b_row.id, 'mode', _mode);
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

REVOKE ALL ON FUNCTION public.revoke_entitlement_by_payment_reference(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_entitlement_by_payment_reference(text, text, text) TO service_role;
