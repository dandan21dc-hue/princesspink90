
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS staff_notes text,
  ADD COLUMN IF NOT EXISTS account_restricted boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.profiles_block_user_staff_field_tamper()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.staff_notes IS DISTINCT FROM OLD.staff_notes
       OR NEW.account_restricted IS DISTINCT FROM OLD.account_restricted THEN
      RAISE EXCEPTION 'Staff-only profile fields can only be modified by admins';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_block_user_staff_field_tamper ON public.profiles;
CREATE TRIGGER profiles_block_user_staff_field_tamper
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.profiles_block_user_staff_field_tamper();
