
-- Tighten memberships user UPDATE policy: users may edit their own row only if
-- privileged billing/perk fields are unchanged. Defense-in-depth alongside the
-- existing memberships_block_user_field_tamper trigger.
DROP POLICY IF EXISTS "Users update own membership perks" ON public.memberships;
CREATE POLICY "Users update own membership perks" ON public.memberships
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.id = public.memberships.id
      AND m.user_id IS NOT DISTINCT FROM public.memberships.user_id
      AND m.kind IS NOT DISTINCT FROM public.memberships.kind
      AND m.expires_at IS NOT DISTINCT FROM public.memberships.expires_at
      AND m.amount_cents IS NOT DISTINCT FROM public.memberships.amount_cents
      AND m.environment IS NOT DISTINCT FROM public.memberships.environment
      AND m.private_session_bundle_id IS NOT DISTINCT FROM public.memberships.private_session_bundle_id
      AND m.private_session_bundle_granted_at IS NOT DISTINCT FROM public.memberships.private_session_bundle_granted_at
  )
);

-- Tighten rsvps user UPDATE policy: users may edit their own RSVP but must not
-- alter check-in, waiver, consent, entry code, or identity fields. Complements
-- the existing rsvps_block_user_field_tamper trigger.
DROP POLICY IF EXISTS "user updates own rsvp" ON public.rsvps;
CREATE POLICY "user updates own rsvp" ON public.rsvps
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1 FROM public.rsvps r
    WHERE r.id = public.rsvps.id
      AND r.user_id IS NOT DISTINCT FROM public.rsvps.user_id
      AND r.event_id IS NOT DISTINCT FROM public.rsvps.event_id
      AND r.checked_in_at IS NOT DISTINCT FROM public.rsvps.checked_in_at
      AND r.checked_in_by IS NOT DISTINCT FROM public.rsvps.checked_in_by
      AND r.door_notes IS NOT DISTINCT FROM public.rsvps.door_notes
      AND r.waiver_signature IS NOT DISTINCT FROM public.rsvps.waiver_signature
      AND r.waiver_accepted_at IS NOT DISTINCT FROM public.rsvps.waiver_accepted_at
      AND r.entry_code IS NOT DISTINCT FROM public.rsvps.entry_code
      AND r.entry_phrase IS NOT DISTINCT FROM public.rsvps.entry_phrase
      AND r.ticket_code IS NOT DISTINCT FROM public.rsvps.ticket_code
  )
);
