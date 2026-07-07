
-- Normalize any existing currency values to lowercase 'aud' and enforce AUD-only via CHECK constraints.
UPDATE public.content_items SET currency = 'aud' WHERE currency IS DISTINCT FROM 'aud';
UPDATE public.panty_listings SET currency = 'aud' WHERE currency IS DISTINCT FROM 'aud';
UPDATE public.panty_orders SET currency = 'aud' WHERE currency IS DISTINCT FROM 'aud';
UPDATE public.private_room_bookings SET currency = 'aud' WHERE currency IS DISTINCT FROM 'aud';

ALTER TABLE public.content_items
  ALTER COLUMN currency SET DEFAULT 'aud',
  ALTER COLUMN currency SET NOT NULL,
  DROP CONSTRAINT IF EXISTS content_items_currency_aud_only,
  ADD CONSTRAINT content_items_currency_aud_only CHECK (currency = 'aud');

ALTER TABLE public.panty_listings
  ALTER COLUMN currency SET DEFAULT 'aud',
  ALTER COLUMN currency SET NOT NULL,
  DROP CONSTRAINT IF EXISTS panty_listings_currency_aud_only,
  ADD CONSTRAINT panty_listings_currency_aud_only CHECK (currency = 'aud');

ALTER TABLE public.panty_orders
  ALTER COLUMN currency SET DEFAULT 'aud',
  ALTER COLUMN currency SET NOT NULL,
  DROP CONSTRAINT IF EXISTS panty_orders_currency_aud_only,
  ADD CONSTRAINT panty_orders_currency_aud_only CHECK (currency = 'aud');

ALTER TABLE public.private_room_bookings
  ALTER COLUMN currency SET DEFAULT 'aud',
  ALTER COLUMN currency SET NOT NULL,
  DROP CONSTRAINT IF EXISTS private_room_bookings_currency_aud_only,
  ADD CONSTRAINT private_room_bookings_currency_aud_only CHECK (currency = 'aud');
