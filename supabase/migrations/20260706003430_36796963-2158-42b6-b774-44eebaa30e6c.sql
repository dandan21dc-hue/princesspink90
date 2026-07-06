DO $$
DECLARE
  base_url text := 'https://project--2ea7609b-c928-4ad6-b438-a4db3aadd458-dev.lovable.app';
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'dunning-escalation') THEN
    PERFORM cron.unschedule('dunning-escalation');
  END IF;
  PERFORM cron.schedule(
    'dunning-escalation',
    '0 10 * * *',
    format($cron$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'ACCOUNT_PURGE_CRON_SECRET'
          )
        ),
        body := '{}'::jsonb
      ) AS request_id;
    $cron$, base_url || '/api/public/cron/dunning-escalation')
  );
END $$;