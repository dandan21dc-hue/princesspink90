
CREATE TABLE public.analytics_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL,
  plan text,
  action text,
  tier_kind text,
  session_id text,
  user_id uuid,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX analytics_events_event_created_idx ON public.analytics_events (event, created_at DESC);
CREATE INDEX analytics_events_plan_idx ON public.analytics_events (plan);
CREATE INDEX analytics_events_session_idx ON public.analytics_events (session_id);

GRANT INSERT ON public.analytics_events TO anon, authenticated;
GRANT ALL ON public.analytics_events TO service_role;

ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can insert analytics events"
  ON public.analytics_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    event = ANY (ARRAY[
      'boutique_tier_click',
      'all_access_tier_click',
      'checkout_completed'
    ])
  );
