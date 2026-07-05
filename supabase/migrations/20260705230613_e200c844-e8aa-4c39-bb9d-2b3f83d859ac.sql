
CREATE TABLE public.panty_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  variant text NOT NULL CHECK (variant IN ('panty_24hr_aud','panty_48hr_aud','panty_72hr_aud')),
  hours integer NOT NULL CHECK (hours IN (24,48,72)),
  stripe_session_id text UNIQUE,
  amount_cents integer NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'aud',
  environment text NOT NULL DEFAULT 'sandbox',
  status text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','shipped','delivered','refunded','disputed','canceled')),
  customer_email text,
  shipping_name text,
  shipping_line1 text,
  shipping_line2 text,
  shipping_city text,
  shipping_state text,
  shipping_postal_code text,
  shipping_country text,
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_panty_orders_user ON public.panty_orders(user_id);
CREATE INDEX idx_panty_orders_status ON public.panty_orders(status);

GRANT SELECT ON public.panty_orders TO authenticated;
GRANT ALL ON public.panty_orders TO service_role;

ALTER TABLE public.panty_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own panty orders"
  ON public.panty_orders FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all panty orders"
  ON public.panty_orders FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins update panty orders"
  ON public.panty_orders FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_panty_orders_updated
  BEFORE UPDATE ON public.panty_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
