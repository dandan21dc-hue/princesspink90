
-- 1. Restrict profiles SELECT to authenticated users only
DROP POLICY IF EXISTS "profiles readable by all" ON public.profiles;
CREATE POLICY "Authenticated users can view profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (true);

-- 2. Add content-media SELECT policy for entitled buyers/subscribers
CREATE POLICY "Entitled users can read content-media"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'content-media'
    AND (
      auth.uid() = owner
      OR EXISTS (
        SELECT 1 FROM public.subscriptions s
        WHERE s.user_id = auth.uid()
          AND s.status IN ('active','trialing','past_due')
          AND (s.current_period_end IS NULL OR s.current_period_end > now())
      )
      OR EXISTS (
        SELECT 1 FROM public.memberships m
        WHERE m.user_id = auth.uid()
          AND (
            m.kind = 'lifetime'
            OR (m.kind LIKE 'term_pass_%' AND m.expires_at IS NOT NULL AND m.expires_at > now())
          )
      )
      OR EXISTS (
        SELECT 1
        FROM public.content_purchases cp
        JOIN public.content_items ci ON ci.id = cp.content_item_id
        WHERE cp.user_id = auth.uid()
          AND ci.media_urls::jsonb @> jsonb_build_array(jsonb_build_object('url', storage.objects.name))
      )
    )
  );

-- 3. Set immutable search_path on functions that lack it
ALTER FUNCTION public.enqueue_email(text, jsonb) SET search_path = public, pgmq;
ALTER FUNCTION public.read_email_batch(text, integer, integer) SET search_path = public, pgmq;
ALTER FUNCTION public.delete_email(text, bigint) SET search_path = public, pgmq;
ALTER FUNCTION public.move_to_dlq(text, text, bigint, jsonb) SET search_path = public, pgmq;

-- 4. Revoke EXECUTE from anon/authenticated on internal-only SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.enqueue_email(text, jsonb) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.read_email_batch(text, integer, integer) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_email(text, bigint) FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.move_to_dlq(text, text, bigint, jsonb) FROM anon, authenticated, PUBLIC;
-- email_queue_dispatch / email_queue_wake are SECURITY DEFINER functions created
-- outside of migration files (via the Management API). They appear in types.ts so
-- they exist on the live DB. REVOKE is guarded because on a fresh DB reset (CI)
-- these functions are absent and PostgreSQL's REVOKE has no IF EXISTS syntax.
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.email_queue_dispatch() FROM anon, authenticated, PUBLIC;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
DO $$ BEGIN
  REVOKE EXECUTE ON FUNCTION public.email_queue_wake() FROM anon, authenticated, PUBLIC;
EXCEPTION WHEN undefined_function THEN NULL;
END $$;
REVOKE EXECUTE ON FUNCTION public.rsvps_assign_entry_code() FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rsvps_assign_entry_phrase() FROM anon, authenticated, PUBLIC;

-- 5. Revoke EXECUTE from anon on admin-only RPCs (keep authenticated; functions self-check has_role)
REVOKE EXECUTE ON FUNCTION public.cron_health_snapshot() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.go_live_status() FROM anon, PUBLIC;
