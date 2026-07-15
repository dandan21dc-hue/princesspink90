UPDATE public.site_settings
SET
  email = 'midnight-glory@princesspink90.com',
  fetlife_handle = 'Gloryhole-Queen',
  updated_at = now()
WHERE id = 'host'
  AND (email IS DISTINCT FROM 'midnight-glory@princesspink90.com'
       OR fetlife_handle IS DISTINCT FROM 'Gloryhole-Queen');

INSERT INTO public.site_settings (id, email, fetlife_handle, reddit_handle)
SELECT 'host', 'midnight-glory@princesspink90.com', 'Gloryhole-Queen', '19pink-princess90'
WHERE NOT EXISTS (SELECT 1 FROM public.site_settings WHERE id = 'host');