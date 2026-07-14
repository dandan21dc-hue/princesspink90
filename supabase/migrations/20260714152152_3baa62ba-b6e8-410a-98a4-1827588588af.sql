ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS session_price_cents integer NOT NULL DEFAULT 27500,
  ADD COLUMN IF NOT EXISTS session_duration_minutes integer NOT NULL DEFAULT 60;

ALTER TABLE public.site_settings
  ADD CONSTRAINT site_settings_session_price_cents_positive CHECK (session_price_cents > 0),
  ADD CONSTRAINT site_settings_session_duration_minutes_positive CHECK (session_duration_minutes > 0 AND session_duration_minutes <= 480);
