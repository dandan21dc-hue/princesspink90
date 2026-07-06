
-- The existing memberships_block_user_field_tamper trigger already prevents
-- non-admin users from modifying kind, expires_at, amount_cents, environment,
-- private_session_bundle_id/granted_at, user_id, event_ticket_used_at/event_id,
-- and private_session_requested_at/fulfilled_at. Replace the confusing
-- self-referential WITH CHECK with a simple owner scope; the trigger is the
-- source of truth for column-level protection.
DROP POLICY IF EXISTS "Users update own membership perks" ON public.memberships;
CREATE POLICY "Users update own membership perks"
ON public.memberships
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
