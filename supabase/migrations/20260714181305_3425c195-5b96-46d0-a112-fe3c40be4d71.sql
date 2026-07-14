
CREATE OR REPLACE FUNCTION public.search_admin_audit_ids(_q text)
RETURNS TABLE(id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  IF _q IS NULL OR btrim(_q) = '' THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT a.id
    FROM public.admin_activity_audit a
    WHERE
      a.action ILIKE '%' || _q || '%'
      OR a.resource ILIKE '%' || _q || '%'
      OR a.metadata::text ILIKE '%' || _q || '%'
      OR a.id::text ILIKE _q || '%'
      OR (_q ~ '^[0-9]+$' AND a.seq = _q::bigint)
    LIMIT 5000;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_admin_audit_ids(text) TO authenticated;
