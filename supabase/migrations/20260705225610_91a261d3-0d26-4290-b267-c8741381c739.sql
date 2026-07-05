-- Private-room perk: half-hour session + post-session picture/video bundle
ALTER TABLE public.memberships
  ADD COLUMN IF NOT EXISTS private_session_duration_minutes integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS private_session_bundle_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS private_session_bundle_granted_at timestamp with time zone;

ALTER TABLE public.memberships
  ADD CONSTRAINT memberships_private_session_duration_positive
  CHECK (private_session_duration_minutes > 0 AND private_session_duration_minutes <= 240);

-- Extend the access-check function to include the private-session bundle grant.
-- Existing lifetime rule already unlocks all content; this branch also lets
-- future non-lifetime perk holders (or a revoked-lifetime edge case) still
-- reach the specific bundle that was delivered to them.
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
        SELECT 1 FROM public.memberships
        WHERE user_id = _user_id
          AND environment = _env
          AND private_session_bundle_id = _content_id
          AND private_session_bundle_granted_at IS NOT NULL
      )
      OR EXISTS (
        SELECT 1 FROM public.content_items ci
        WHERE ci.id = _content_id AND ci.creator_id = _user_id
      )
    );
$function$;