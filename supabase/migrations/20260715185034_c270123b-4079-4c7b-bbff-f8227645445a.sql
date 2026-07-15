
-- 1. Create the webhook secret in vault if it doesn't exist.
DO $$
DECLARE
  existing uuid;
BEGIN
  SELECT id INTO existing FROM vault.secrets WHERE name = 'receipt_webhook_secret' LIMIT 1;
  IF existing IS NULL THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'receipt_webhook_secret');
  END IF;
END $$;

-- 2. Trigger function: POST { source, row_id } to the receipt endpoint.
CREATE OR REPLACE FUNCTION public.notify_send_receipt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO secret
      FROM vault.decrypted_secrets
      WHERE name = 'receipt_webhook_secret'
      LIMIT 1;

    IF secret IS NULL THEN
      RAISE WARNING 'notify_send_receipt: webhook secret missing';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := 'https://project--2ea7609b-c928-4ad6-b438-a4db3aadd458.lovable.app/api/public/hooks/send-receipt',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || secret
      ),
      body := jsonb_build_object('source', TG_TABLE_NAME, 'row_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block the insert on notification failures.
    RAISE WARNING 'notify_send_receipt failed for %: %', TG_TABLE_NAME, SQLERRM;
  END;
  RETURN NEW;
END;
$fn$;

-- 3. AFTER INSERT triggers on the four purchase tables.
DROP TRIGGER IF EXISTS send_receipt_on_panty_order ON public.panty_orders;
CREATE TRIGGER send_receipt_on_panty_order
  AFTER INSERT ON public.panty_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_send_receipt();

DROP TRIGGER IF EXISTS send_receipt_on_private_room_booking ON public.private_room_bookings;
CREATE TRIGGER send_receipt_on_private_room_booking
  AFTER INSERT ON public.private_room_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_send_receipt();

DROP TRIGGER IF EXISTS send_receipt_on_membership ON public.memberships;
CREATE TRIGGER send_receipt_on_membership
  AFTER INSERT ON public.memberships
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_send_receipt();

DROP TRIGGER IF EXISTS send_receipt_on_content_purchase ON public.content_purchases;
CREATE TRIGGER send_receipt_on_content_purchase
  AFTER INSERT ON public.content_purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_send_receipt();
