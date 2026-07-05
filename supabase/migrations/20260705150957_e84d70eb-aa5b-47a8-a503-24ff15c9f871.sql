CREATE TABLE public.site_settings (
  id TEXT PRIMARY KEY DEFAULT 'host',
  email TEXT NOT NULL DEFAULT 'princesspink9014@gmail.com',
  fetlife_handle TEXT NOT NULL DEFAULT 'pink_princess90',
  reddit_handle TEXT NOT NULL DEFAULT '19pink-princess90',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT site_settings_singleton CHECK (id = 'host')
);

GRANT SELECT ON public.site_settings TO anon, authenticated;
GRANT ALL ON public.site_settings TO service_role;
GRANT UPDATE ON public.site_settings TO authenticated;

ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read site settings"
  ON public.site_settings FOR SELECT
  USING (true);

CREATE POLICY "Admins can update site settings"
  ON public.site_settings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER site_settings_touch_updated_at
  BEFORE UPDATE ON public.site_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

INSERT INTO public.site_settings (id) VALUES ('host') ON CONFLICT DO NOTHING;