
-- 1. Move staff_notes into an admin-only table
CREATE TABLE public.profile_staff_notes (
  user_id uuid PRIMARY KEY,
  notes text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profile_staff_notes TO authenticated;
GRANT ALL ON public.profile_staff_notes TO service_role;

ALTER TABLE public.profile_staff_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read staff notes"
  ON public.profile_staff_notes
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins write staff notes"
  ON public.profile_staff_notes
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER profile_staff_notes_touch
  BEFORE UPDATE ON public.profile_staff_notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Migrate any existing notes off profiles.
INSERT INTO public.profile_staff_notes (user_id, notes)
SELECT user_id, staff_notes
FROM public.profiles
WHERE staff_notes IS NOT NULL AND btrim(staff_notes) <> ''
ON CONFLICT (user_id) DO UPDATE SET notes = EXCLUDED.notes;

-- Drop the exposed column.
ALTER TABLE public.profiles DROP COLUMN staff_notes;

-- 2. Widen the profile tamper-block trigger and remove the (now dropped)
-- staff_notes reference from the older trigger body.
CREATE OR REPLACE FUNCTION public.profiles_block_user_staff_field_tamper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.account_restricted IS DISTINCT FROM OLD.account_restricted
       OR NEW.verification_status IS DISTINCT FROM OLD.verification_status
       OR NEW.veriff_session_id IS DISTINCT FROM OLD.veriff_session_id
       OR NEW.reward_points IS DISTINCT FROM OLD.reward_points
       OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at THEN
      RAISE EXCEPTION 'Staff-only profile fields can only be modified by admins';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Keep this trigger function un-callable from the API surface; it only
-- runs as a table trigger.
REVOKE EXECUTE ON FUNCTION public.profiles_block_user_staff_field_tamper() FROM PUBLIC, anon, authenticated;

-- 3. health_screenings: reject self-approved rows on insert
DROP POLICY IF EXISTS "Users insert own screenings" ON public.health_screenings;
CREATE POLICY "Users insert own screenings"
  ON public.health_screenings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND valid_until IS NULL
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
    AND notes IS NULL
  );

-- 4. cohost_applications: reject self-approved rows on insert
DROP POLICY IF EXISTS "Users insert own cohost application" ON public.cohost_applications;
CREATE POLICY "Users insert own cohost application"
  ON public.cohost_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending'
    AND reviewed_at IS NULL
    AND reviewed_by IS NULL
    AND admin_notes IS NULL
  );

-- 5. rsvps: require the age/health/waiver gates on self-insert so a user
-- can't fabricate a confirmed RSVP via the Data API and skip the checks
-- the rsvpToEvent server function enforces.
DROP POLICY IF EXISTS "user creates own rsvp" ON public.rsvps;
CREATE POLICY "user creates own rsvp"
  ON public.rsvps
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND public.has_age_verification(auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.health_screenings hs
      WHERE hs.user_id = auth.uid()
        AND hs.status = 'approved'
        AND (hs.valid_until IS NULL OR hs.valid_until >= CURRENT_DATE)
    )
    AND waiver_accepted_at IS NOT NULL
    AND waiver_signature IS NOT NULL
    AND btrim(waiver_signature) <> ''
    AND waiver_text_hash IS NOT NULL
    AND age_confirmed_at IS NOT NULL
    AND consent_confirmed_at IS NOT NULL
    AND entry_code IS NULL
    AND checked_in_at IS NULL
    AND checked_in_by IS NULL
    AND door_notes IS NULL
    AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.id = event_id
        AND encode(
          extensions.digest(coalesce(btrim(e.waiver_text), ''), 'sha256'),
          'hex'
        ) = waiver_text_hash
    )
  );
