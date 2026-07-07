CREATE TABLE public.panty_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  color text,
  style text,
  size text,
  cover_url text,
  media_urls text[] NOT NULL DEFAULT '{}',
  price_cents integer,
  currency text NOT NULL DEFAULT 'aud',
  published boolean NOT NULL DEFAULT false,
  sold boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.panty_listings TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.panty_listings TO authenticated;
GRANT ALL ON public.panty_listings TO service_role;

ALTER TABLE public.panty_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public can view published available listings"
  ON public.panty_listings
  FOR SELECT
  TO anon, authenticated
  USING (published = true AND sold = false);

CREATE POLICY "Admins view all panty listings"
  ON public.panty_listings
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins insert panty listings"
  ON public.panty_listings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins update panty listings"
  ON public.panty_listings
  FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins delete panty listings"
  ON public.panty_listings
  FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE TRIGGER trg_panty_listings_updated_at
  BEFORE UPDATE ON public.panty_listings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE INDEX idx_panty_listings_published ON public.panty_listings (published, sold, sort_order);

ALTER TABLE public.panty_orders
  ADD COLUMN panty_listing_id uuid REFERENCES public.panty_listings(id) ON DELETE SET NULL;
