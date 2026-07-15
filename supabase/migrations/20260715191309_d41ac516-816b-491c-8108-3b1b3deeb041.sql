
CREATE OR REPLACE FUNCTION public.set_updated_at_timestamp()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.all_access_pass_tiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id text NOT NULL UNIQUE,
  price_id text UNIQUE,
  kind text NOT NULL,
  label text NOT NULL,
  price_display text NOT NULL,
  cadence text NOT NULL DEFAULT 'one-time',
  perk text,
  price_cents integer NOT NULL CHECK (price_cents >= 100),
  currency text NOT NULL DEFAULT 'aud',
  invoice_description text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.all_access_pass_tiers TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.all_access_pass_tiers TO authenticated;
GRANT ALL ON public.all_access_pass_tiers TO service_role;

ALTER TABLE public.all_access_pass_tiers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Active tiers are publicly readable"
  ON public.all_access_pass_tiers
  FOR SELECT
  USING (is_active = true);

CREATE POLICY "Admins can read every tier"
  ON public.all_access_pass_tiers
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert tiers"
  ON public.all_access_pass_tiers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update tiers"
  ON public.all_access_pass_tiers
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete tiers"
  ON public.all_access_pass_tiers
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER trg_all_access_pass_tiers_updated_at
  BEFORE UPDATE ON public.all_access_pass_tiers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at_timestamp();

INSERT INTO public.all_access_pass_tiers
  (plan_id, price_id, kind, label, price_display, cadence, perk, price_cents, currency, invoice_description, sort_order, is_active)
VALUES
  ('all_access_30d_aud',  NULL,                    'aap30d',   '30-Day Pass',    'A$10',  'one-time', '30 days of full library access · pay in crypto',       1000,  'aud', 'All-Access Pass — 30 days (Midnight Glory)',    10, true),
  ('all_access_90d_aud',  'aap_90d_aud',           'aap90d',   '3-Month Pass',   'A$27',  'one-time', '90 days of full library access · pay in crypto',       2700,  'aud', 'All-Access Pass — 3 months (Midnight Glory)',   20, true),
  ('all_access_180d_aud', 'aap_180d_aud',          'aap180d',  '6-Month Pass',   'A$50',  'one-time', '180 days of full library access · pay in crypto',      5000,  'aud', 'All-Access Pass — 6 months (Midnight Glory)',   30, true),
  ('all_access_365d_aud', 'aap_365d_aud',          'aap365d',  '12-Month Pass',  'A$90',  'one-time', '365 days of full library access · pay in crypto',      9000,  'aud', 'All-Access Pass — 12 months (Midnight Glory)',  40, true),
  ('lifetime_onetime_aud','lifetime_onetime_aud',  'lifetime', 'Lifetime',       'A$600', 'one-time', 'Never expires · + 1 ticketed event & 1 private room session', 60000, 'aud', 'Lifetime Membership (Midnight Glory)',          50, true);
