
-- 1. memberships: block user-initiated changes to billing/entitlement fields
CREATE OR REPLACE FUNCTION public.memberships_block_user_field_tamper()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.kind IS DISTINCT FROM OLD.kind
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
       OR NEW.amount_cents IS DISTINCT FROM OLD.amount_cents
       OR NEW.environment IS DISTINCT FROM OLD.environment
       OR NEW.private_session_bundle_id IS DISTINCT FROM OLD.private_session_bundle_id
       OR NEW.private_session_bundle_granted_at IS DISTINCT FROM OLD.private_session_bundle_granted_at
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Membership billing fields can only be modified by staff or server processes';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS memberships_block_user_field_tamper ON public.memberships;
CREATE TRIGGER memberships_block_user_field_tamper
BEFORE UPDATE ON public.memberships
FOR EACH ROW EXECUTE FUNCTION public.memberships_block_user_field_tamper();

-- 2. rsvps: block attendees from forging check-in/waiver/entry-code fields
CREATE OR REPLACE FUNCTION public.rsvps_block_user_field_tamper()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE is_host boolean;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;
  IF public.has_role(auth.uid(), 'admin'::app_role) THEN
    RETURN NEW;
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.events e WHERE e.id = NEW.event_id AND e.host_id = auth.uid())
    INTO is_host;
  IF is_host THEN
    RETURN NEW;
  END IF;
  IF NEW.checked_in_at IS DISTINCT FROM OLD.checked_in_at
     OR NEW.checked_in_by IS DISTINCT FROM OLD.checked_in_by
     OR NEW.door_notes IS DISTINCT FROM OLD.door_notes
     OR NEW.waiver_signature IS DISTINCT FROM OLD.waiver_signature
     OR NEW.waiver_accepted_at IS DISTINCT FROM OLD.waiver_accepted_at
     OR NEW.entry_code IS DISTINCT FROM OLD.entry_code
     OR NEW.entry_phrase IS DISTINCT FROM OLD.entry_phrase
     OR NEW.ticket_code IS DISTINCT FROM OLD.ticket_code
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.event_id IS DISTINCT FROM OLD.event_id THEN
    RAISE EXCEPTION 'Check-in, waiver, and entry code fields can only be modified by staff or the event host';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS rsvps_block_user_field_tamper ON public.rsvps;
CREATE TRIGGER rsvps_block_user_field_tamper
BEFORE UPDATE ON public.rsvps
FOR EACH ROW EXECUTE FUNCTION public.rsvps_block_user_field_tamper();

-- 3. analytics_events: bind user_id to auth.uid()
DROP POLICY IF EXISTS "Anyone can insert analytics events" ON public.analytics_events;
CREATE POLICY "Anyone can insert analytics events"
ON public.analytics_events
FOR INSERT
WITH CHECK (
  event = ANY (ARRAY[
    'boutique_tier_click','all_access_tier_click','checkout_completed',
    'panty_checkout_start','panty_checkout_started','panty_checkout_confirmed',
    'panty_checkout_pending','panty_checkout_cancelled','stripe_checkout_return_failed'
  ])
  AND (user_id IS NULL OR user_id = auth.uid())
);

-- 4. support_conversations: block user from changing admin-facing fields
CREATE OR REPLACE FUNCTION public.support_conversations_block_user_field_tamper()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.escalated IS DISTINCT FROM OLD.escalated
       OR NEW.escalated_at IS DISTINCT FROM OLD.escalated_at
       OR NEW.escalation_reason IS DISTINCT FROM OLD.escalation_reason
       OR NEW.admin_unread_count IS DISTINCT FROM OLD.admin_unread_count
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Support conversation status and escalation fields can only be modified by staff or the AI escalation flow';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS support_conversations_block_user_field_tamper ON public.support_conversations;
CREATE TRIGGER support_conversations_block_user_field_tamper
BEFORE UPDATE ON public.support_conversations
FOR EACH ROW EXECUTE FUNCTION public.support_conversations_block_user_field_tamper();

-- 5. cohost_applications: block applicants from setting admin review fields
CREATE OR REPLACE FUNCTION public.cohost_applications_block_admin_field_tamper()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
       OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
       OR NEW.admin_notes IS DISTINCT FROM OLD.admin_notes
       OR NEW.status IS DISTINCT FROM OLD.status
       OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Admin review fields on co-host applications can only be modified by admins';
    END IF;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS cohost_applications_block_admin_field_tamper ON public.cohost_applications;
CREATE TRIGGER cohost_applications_block_admin_field_tamper
BEFORE UPDATE ON public.cohost_applications
FOR EACH ROW EXECUTE FUNCTION public.cohost_applications_block_admin_field_tamper();
