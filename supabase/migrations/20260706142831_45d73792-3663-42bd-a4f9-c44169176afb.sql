
-- Guarantee webhook idempotency: only one term_pass_12 per (user, env, subscription marker).
CREATE UNIQUE INDEX IF NOT EXISTS memberships_term_pass_sub_marker_idx
  ON public.memberships (user_id, kind, environment, stripe_session_id)
  WHERE kind LIKE 'term_pass_%' AND stripe_session_id LIKE 'sub_%';

-- Backfill: any active/trialing 12-month subscriber without a matching
-- term_pass_12 row gets one, expiring at current_period_end (or now + 12mo
-- when the period end is unknown).
INSERT INTO public.memberships (user_id, kind, term_months, stripe_session_id, environment, expires_at)
SELECT
  s.user_id,
  'term_pass_12',
  12,
  'sub_' || s.stripe_subscription_id,
  s.environment,
  COALESCE(s.current_period_end, now() + interval '12 months')
FROM public.subscriptions s
WHERE s.price_id = 'all_access_12mo_monthly_aud'
  AND s.status IN ('active','trialing','past_due')
  AND (s.current_period_end IS NULL OR s.current_period_end > now())
  AND NOT EXISTS (
    SELECT 1 FROM public.memberships m
    WHERE m.user_id = s.user_id
      AND m.kind = 'term_pass_12'
      AND m.environment = s.environment
      AND m.stripe_session_id = 'sub_' || s.stripe_subscription_id
  );
