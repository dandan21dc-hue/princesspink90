-- 1. Dunning schedule table for escalation emails
CREATE TABLE public.dunning_schedule (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT NOT NULL UNIQUE,
  stripe_subscription_id TEXT NOT NULL,
  environment TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'day_3' CHECK (stage IN ('day_3','day_7','day_14','done','canceled')),
  next_email_at TIMESTAMPTZ NOT NULL,
  last_sent_stage TEXT,
  last_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dunning_next_email ON public.dunning_schedule(next_email_at) WHERE stage NOT IN ('done','canceled');
CREATE INDEX idx_dunning_subscription ON public.dunning_schedule(stripe_subscription_id);

GRANT SELECT ON public.dunning_schedule TO authenticated;
GRANT ALL ON public.dunning_schedule TO service_role;

ALTER TABLE public.dunning_schedule ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own dunning rows"
  ON public.dunning_schedule FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER trg_dunning_touch BEFORE UPDATE ON public.dunning_schedule
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Age verification helper (called from beforeLoad via server fn)
CREATE OR REPLACE FUNCTION public.has_age_verification(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.age_verifications
    WHERE user_id = _user_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_age_verification(uuid) TO authenticated;

-- 3. Add canceled-grace clause to user_can_access_content so it matches the hook & getMyLibrary
CREATE OR REPLACE FUNCTION public.user_can_access_content(_user_id uuid, _content_id uuid, _env text DEFAULT 'sandbox'::text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
          AND (
            (status IN ('active','trialing','past_due')
             AND (current_period_end IS NULL OR current_period_end > now()))
            OR (status = 'canceled' AND current_period_end IS NOT NULL AND current_period_end > now())
          )
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
$$;

-- 4. Daily dunning-escalation cron (10:00 UTC)
DO $$
DECLARE
  anon_key text := 'sb_publishable_ooJ1WmDfZzwdSel-TNlX1A_9a3AZzjp';
  base_url text := 'https://project--2ea7609b-c928-4ad6-b438-a4db3aadd458-dev.lovable.app';
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dunning-escalation') THEN
    PERFORM cron.unschedule('dunning-escalation');
  END IF;
  PERFORM cron.schedule(
    'dunning-escalation',
    '0 10 * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := %L::jsonb,
        body := '{}'::jsonb
      ) AS request_id;
    $cron$,
      base_url || '/api/public/cron/dunning-escalation',
      json_build_object('Content-Type','application/json','apikey', anon_key)::text
    )
  );
END $$;