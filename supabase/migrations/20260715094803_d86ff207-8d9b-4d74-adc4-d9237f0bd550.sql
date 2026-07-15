CREATE INDEX IF NOT EXISTS nowpayments_ipn_events_first_seen_idx
  ON public.nowpayments_ipn_events (first_seen_at DESC);

CREATE INDEX IF NOT EXISTS nowpayments_ipn_events_last_status_idx
  ON public.nowpayments_ipn_events (last_status, last_seen_at DESC);

CREATE INDEX IF NOT EXISTS nowpayments_ipn_events_payment_id_idx
  ON public.nowpayments_ipn_events (payment_id);