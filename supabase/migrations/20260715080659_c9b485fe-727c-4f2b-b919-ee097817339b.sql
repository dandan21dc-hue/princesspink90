
ALTER TABLE public.nowpayments_ipn_events
  DROP CONSTRAINT nowpayments_ipn_events_pkey;

ALTER TABLE public.nowpayments_ipn_events
  ADD CONSTRAINT nowpayments_ipn_events_pkey PRIMARY KEY (payment_id, last_status);

-- first_status becomes redundant now that (payment_id, status) is the key.
ALTER TABLE public.nowpayments_ipn_events
  DROP COLUMN first_status;
