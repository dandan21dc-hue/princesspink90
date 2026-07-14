
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS replay_of_event_id uuid REFERENCES public.stripe_webhook_events(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS replayed_at timestamptz;

CREATE INDEX IF NOT EXISTS stripe_webhook_events_correlation_idx
  ON public.stripe_webhook_events (correlation_id);

CREATE INDEX IF NOT EXISTS stripe_webhook_events_replay_of_idx
  ON public.stripe_webhook_events (replay_of_event_id);
