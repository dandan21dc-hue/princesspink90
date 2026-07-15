-- Backfill: guarantee the singleton site_settings row holds the new contact
-- values and force `updated_at` to advance so anything keyed on it busts.
-- Idempotent — safe to re-run.
UPDATE public.site_settings
   SET email = 'midnight-glory@princesspink90.com',
       fetlife_handle = 'Gloryhole-Queen',
       updated_at = now()
 WHERE id = 'host';

-- If the singleton row is somehow missing, create it with the new values so
-- the app never falls back to hard-coded defaults after this migration.
INSERT INTO public.site_settings (id, email, fetlife_handle)
SELECT 'host', 'midnight-glory@princesspink90.com', 'Gloryhole-Queen'
WHERE NOT EXISTS (SELECT 1 FROM public.site_settings WHERE id = 'host');