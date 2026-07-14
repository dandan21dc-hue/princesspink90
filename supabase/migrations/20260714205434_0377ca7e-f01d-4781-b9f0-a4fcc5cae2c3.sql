-- Remove Stripe schema, subscriptions, and dunning; rename stripe_session_id → external_payment_reference on remaining order-bearing tables.

-- 1) Update functions that reference the subscriptions table BEFORE dropping it.
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
      )
      OR EXISTS (
        SELECT 1 FROM public.content_items ci
        WHERE ci.id = _content_id AND ci.creator_id = _user_id
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.purge_account_rows(_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.content_purchases WHERE user_id = _user_id;
  DELETE FROM public.memberships WHERE user_id = _user_id;
  DELETE FROM public.rsvps WHERE user_id = _user_id;
  DELETE FROM public.panty_orders WHERE user_id = _user_id;
  DELETE FROM public.private_room_bookings WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;
  DELETE FROM public.age_verifications WHERE user_id = _user_id;
  DELETE FROM public.health_screenings WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  UPDATE public.profiles SET deleted_at = now() WHERE user_id = _user_id;
END;
$function$;

-- Rewrite payment integrity checks to drop Stripe-specific findings.
CREATE OR REPLACE FUNCTION public.run_payment_integrity_checks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  run_started_at timestamptz := clock_timestamp();
  touched integer := 0;
BEGIN
  -- Auto-resolve any previously-recorded Stripe findings; nothing new to record.
  UPDATE public.payment_integrity_findings
     SET resolved_at = now()
   WHERE resolved_at IS NULL
     AND check_name IN ('webhook_stuck_processing','subscription_expired_still_active');

  SELECT count(*) INTO touched
  FROM public.payment_integrity_findings
  WHERE last_seen_at >= run_started_at;

  RETURN touched;
END;
$function$;

-- 2) Drop Stripe-specific helper function that no longer has any consumer.
DROP FUNCTION IF EXISTS public.has_active_subscription(uuid, text);

-- 3) Drop Stripe-only tables.
DROP TABLE IF EXISTS public.stripe_webhook_events CASCADE;
DROP TABLE IF EXISTS public.subscriptions CASCADE;
DROP TABLE IF EXISTS public.dunning_schedule CASCADE;

-- 4) Rename stripe_session_id → external_payment_reference on the tables that still need
-- a payment reference (memberships already has both — drop the legacy one there).
ALTER TABLE public.memberships DROP COLUMN IF EXISTS stripe_session_id;

ALTER TABLE public.panty_orders DROP CONSTRAINT IF EXISTS panty_orders_stripe_session_id_key;
ALTER TABLE public.panty_orders RENAME COLUMN stripe_session_id TO external_payment_reference;
ALTER TABLE public.panty_orders ADD CONSTRAINT panty_orders_external_payment_reference_key UNIQUE (external_payment_reference);

ALTER TABLE public.content_purchases RENAME COLUMN stripe_session_id TO external_payment_reference;
ALTER TABLE public.private_room_bookings RENAME COLUMN stripe_session_id TO external_payment_reference;
