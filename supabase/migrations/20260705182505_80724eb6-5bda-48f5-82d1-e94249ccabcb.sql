-- Add archive columns to safety_incident_reports for immutable audit trail
ALTER TABLE public.safety_incident_reports
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS archive_reason text;

-- Remove any prior DELETE policies to enforce immutability
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'safety_incident_reports' AND cmd = 'DELETE'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.safety_incident_reports', p.policyname);
  END LOOP;
END $$;

-- Revoke DELETE privilege so records cannot be permanently removed
REVOKE DELETE ON public.safety_incident_reports FROM authenticated, anon;

-- Block updates that would erase core fields (immutability of audit content)
CREATE OR REPLACE FUNCTION public.safety_incident_reports_prevent_field_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.incident_date IS DISTINCT FROM OLD.incident_date
     OR NEW.venue IS DISTINCT FROM OLD.venue
     OR NEW.involved_party IS DISTINCT FROM OLD.involved_party
     OR NEW.nature_of_incident IS DISTINCT FROM OLD.nature_of_incident
     OR NEW.resolution_taken IS DISTINCT FROM OLD.resolution_taken
     OR NEW.created_by IS DISTINCT FROM OLD.created_by
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Safety incident records are immutable; only archive metadata may be updated.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS safety_incident_reports_immutable ON public.safety_incident_reports;
CREATE TRIGGER safety_incident_reports_immutable
  BEFORE UPDATE ON public.safety_incident_reports
  FOR EACH ROW EXECUTE FUNCTION public.safety_incident_reports_prevent_field_mutation();
