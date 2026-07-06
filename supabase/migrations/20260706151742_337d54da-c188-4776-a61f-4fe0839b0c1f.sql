DROP POLICY IF EXISTS "Anyone can insert analytics events" ON public.analytics_events;

CREATE POLICY "Anyone can insert analytics events"
ON public.analytics_events
FOR INSERT
TO anon, authenticated
WITH CHECK (
  event = ANY (ARRAY[
    'boutique_tier_click',
    'all_access_tier_click',
    'checkout_completed',
    'panty_checkout_start',
    'panty_checkout_started',
    'panty_checkout_confirmed',
    'panty_checkout_pending',
    'panty_checkout_cancelled',
    'stripe_checkout_return_failed'
  ])
);

CREATE INDEX IF NOT EXISTS analytics_events_client_order_ref_idx
  ON public.analytics_events ((props->>'client_order_ref'));