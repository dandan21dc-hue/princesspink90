-- 1. Per-item currency on content_items
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'aud'
  CHECK (currency IN ('aud','usd'));

-- 2. Soft-delete fields on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS pending_deletion_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_profiles_pending_deletion_at
  ON public.profiles(pending_deletion_at)
  WHERE pending_deletion_at IS NOT NULL;

-- 3. Re-attach handle_new_user trigger to auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 4. Purge helper for soft-deleted accounts whose window expired.
--    Deletes app-owned rows and returns the user_ids the caller should
--    then remove from auth.users via the Auth Admin API (we cannot touch
--    auth.users directly from SQL).
CREATE OR REPLACE FUNCTION public.list_accounts_to_purge()
RETURNS TABLE(user_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT user_id
  FROM public.profiles
  WHERE pending_deletion_at IS NOT NULL
    AND pending_deletion_at < now()
    AND deleted_at IS NULL;
$$;

CREATE OR REPLACE FUNCTION public.purge_account_rows(_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.content_purchases WHERE user_id = _user_id;
  DELETE FROM public.memberships WHERE user_id = _user_id;
  DELETE FROM public.rsvps WHERE user_id = _user_id;
  DELETE FROM public.panty_orders WHERE user_id = _user_id;
  DELETE FROM public.private_room_bookings WHERE user_id = _user_id;
  DELETE FROM public.subscriptions WHERE user_id = _user_id;
  DELETE FROM public.notifications WHERE user_id = _user_id;
  DELETE FROM public.age_verifications WHERE user_id = _user_id;
  DELETE FROM public.health_screenings WHERE user_id = _user_id;
  DELETE FROM public.user_roles WHERE user_id = _user_id;
  UPDATE public.profiles SET deleted_at = now() WHERE user_id = _user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.list_accounts_to_purge() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_account_rows(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_accounts_to_purge() TO service_role;
GRANT EXECUTE ON FUNCTION public.purge_account_rows(uuid) TO service_role;