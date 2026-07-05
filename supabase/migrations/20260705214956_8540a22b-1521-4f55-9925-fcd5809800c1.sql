CREATE OR REPLACE FUNCTION public.user_can_access_content(_user_id uuid, _content_id uuid, _env text DEFAULT 'sandbox'::text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    _user_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.content_purchases
        WHERE user_id = _user_id
          AND content_item_id = _content_id
          AND environment = _env
      )
      OR EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE user_id = _user_id
          AND environment = _env
          AND status IN ('active','trialing','past_due')
          AND (current_period_end IS NULL OR current_period_end > now())
      )
      OR EXISTS (
        SELECT 1 FROM public.memberships
        WHERE user_id = _user_id
          AND environment = _env
          AND (
            kind = 'lifetime'
            OR (kind LIKE 'term_pass_%' AND expires_at IS NOT NULL AND expires_at > now())
          )
      )
      OR EXISTS (
        SELECT 1 FROM public.content_items ci
        WHERE ci.id = _content_id AND ci.creator_id = _user_id
      )
    );
$function$;