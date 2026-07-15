
CREATE TABLE public.nowpayments_ipn_events (
  payment_id text PRIMARY KEY,
  first_status text NOT NULL,
  last_status text NOT NULL,
  order_id text,
  handled boolean NOT NULL DEFAULT false,
  reason text,
  payload jsonb NOT NULL,
  received_count integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

GRANT ALL ON public.nowpayments_ipn_events TO service_role;

ALTER TABLE public.nowpayments_ipn_events ENABLE ROW LEVEL SECURITY;

-- Admin-only visibility; the webhook writes via service_role and bypasses RLS.
CREATE POLICY "Admins can view IPN events"
  ON public.nowpayments_ipn_events
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE INDEX nowpayments_ipn_events_last_seen_idx
  ON public.nowpayments_ipn_events (last_seen_at DESC);
