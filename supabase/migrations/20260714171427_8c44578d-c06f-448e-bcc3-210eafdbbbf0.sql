-- 1. Track notification state per alert (idempotent send)
ALTER TABLE public.admin_activity_audit_alerts
  ADD COLUMN IF NOT EXISTS notified_at timestamptz;

-- 2. Generate and store a webhook secret in vault (only if missing)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'admin_audit_alert_webhook_secret') THEN
    PERFORM vault.create_secret(encode(gen_random_bytes(32), 'hex'), 'admin_audit_alert_webhook_secret');
  END IF;
END $$;

-- 3. Trigger function: POST alert id to the notification hook
CREATE OR REPLACE FUNCTION public.notify_admin_activity_audit_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO secret
      FROM vault.decrypted_secrets
      WHERE name = 'admin_audit_alert_webhook_secret'
      LIMIT 1;

    IF secret IS NULL THEN
      RAISE WARNING 'notify_admin_activity_audit_alert: webhook secret missing';
      RETURN NEW;
    END IF;

    PERFORM net.http_post(
      url := 'https://project--2ea7609b-c928-4ad6-b438-a4db3aadd458.lovable.app/api/public/hooks/audit-alert-notify',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || secret
      ),
      body := jsonb_build_object('alert_id', NEW.id)
    );
  EXCEPTION WHEN OTHERS THEN
    -- Never block audit alert inserts on notification failures
    RAISE WARNING 'notify_admin_activity_audit_alert failed: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;

-- 4. AFTER INSERT trigger
DROP TRIGGER IF EXISTS admin_activity_audit_alerts_notify_trg ON public.admin_activity_audit_alerts;
CREATE TRIGGER admin_activity_audit_alerts_notify_trg
AFTER INSERT ON public.admin_activity_audit_alerts
FOR EACH ROW EXECUTE FUNCTION public.notify_admin_activity_audit_alert();
