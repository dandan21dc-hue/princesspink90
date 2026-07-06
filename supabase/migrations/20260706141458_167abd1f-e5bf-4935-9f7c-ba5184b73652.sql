
CREATE TABLE public.stripe_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id text,
  event_type text NOT NULL,
  environment text NOT NULL,
  status text NOT NULL DEFAULT 'received',
  error_message text,
  raw_payload jsonb NOT NULL,
  processing_ms integer,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stripe_webhook_events_status_check CHECK (status IN ('received','processing','succeeded','failed','ignored'))
);

CREATE UNIQUE INDEX stripe_webhook_events_event_env_idx
  ON public.stripe_webhook_events (stripe_event_id, environment)
  WHERE stripe_event_id IS NOT NULL;

CREATE INDEX stripe_webhook_events_received_at_idx
  ON public.stripe_webhook_events (received_at DESC);

CREATE INDEX stripe_webhook_events_status_idx
  ON public.stripe_webhook_events (status);

CREATE INDEX stripe_webhook_events_type_idx
  ON public.stripe_webhook_events (event_type);

GRANT SELECT ON public.stripe_webhook_events TO authenticated;
GRANT ALL ON public.stripe_webhook_events TO service_role;

ALTER TABLE public.stripe_webhook_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook events"
  ON public.stripe_webhook_events FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));
