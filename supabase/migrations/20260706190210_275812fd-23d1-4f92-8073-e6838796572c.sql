
-- 1. memberships: tighten UPDATE policy to also protect perk usage tracking fields
DROP POLICY IF EXISTS "Users update own membership perks" ON public.memberships;
CREATE POLICY "Users update own membership perks"
ON public.memberships
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.id = memberships.id
      AND NOT (m.user_id IS DISTINCT FROM memberships.user_id)
      AND NOT (m.kind IS DISTINCT FROM memberships.kind)
      AND NOT (m.expires_at IS DISTINCT FROM memberships.expires_at)
      AND NOT (m.amount_cents IS DISTINCT FROM memberships.amount_cents)
      AND NOT (m.environment IS DISTINCT FROM memberships.environment)
      AND NOT (m.private_session_bundle_id IS DISTINCT FROM memberships.private_session_bundle_id)
      AND NOT (m.private_session_bundle_granted_at IS DISTINCT FROM memberships.private_session_bundle_granted_at)
      AND NOT (m.event_ticket_used_at IS DISTINCT FROM memberships.event_ticket_used_at)
      AND NOT (m.event_ticket_event_id IS DISTINCT FROM memberships.event_ticket_event_id)
      AND NOT (m.private_session_requested_at IS DISTINCT FROM memberships.private_session_requested_at)
      AND NOT (m.private_session_fulfilled_at IS DISTINCT FROM memberships.private_session_fulfilled_at)
  )
);

-- Belt and suspenders: also extend the tamper trigger to cover perk-usage fields
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
       OR NEW.private_session_fulfilled_at IS DISTINCT FROM OLD.private_session_fulfilled_at THEN
      RAISE EXCEPTION 'Membership billing and perk fields can only be modified by staff or server processes';
    END IF;
  END IF;
  RETURN NEW;
END; $function$;

-- 2. support_conversations: split user UPDATE into no-op (blocked); admins keep write access
DROP POLICY IF EXISTS "Users and admins update their conversation" ON public.support_conversations;

CREATE POLICY "Admins update any support conversation"
ON public.support_conversations
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Users cannot directly UPDATE support_conversations rows; all user-side field
-- changes must go through server functions (which run as service role or admin).
-- The existing tamper trigger already blocks escalated/status/etc. for non-admins,
-- and removing the user-scoped UPDATE policy closes the column-gap finding.

-- 3. site_settings: restrict SELECT to admins only; app reads via supabaseAdmin
DROP POLICY IF EXISTS "Authenticated users can read site settings" ON public.site_settings;
CREATE POLICY "Admins read site settings"
ON public.site_settings
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));
