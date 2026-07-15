ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS admin_reward_alerts_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS admin_reward_alert_email text;