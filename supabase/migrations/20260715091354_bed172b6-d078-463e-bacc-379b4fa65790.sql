CREATE OR REPLACE FUNCTION public.admin_find_user_ids_by_email(_email_pattern text)
RETURNS TABLE(user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF _email_pattern IS NULL OR btrim(_email_pattern) = '' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT u.id
    FROM auth.users u
    WHERE u.email ILIKE '%' || _email_pattern || '%'
    LIMIT 500;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_find_user_ids_by_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_find_user_ids_by_email(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_find_user_ids_by_email(text) TO service_role;