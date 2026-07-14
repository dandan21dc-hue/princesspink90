
CREATE TABLE public.map_pins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  description text,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.map_pins TO anon;
GRANT SELECT ON public.map_pins TO authenticated;
GRANT ALL ON public.map_pins TO service_role;

ALTER TABLE public.map_pins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view map pins"
  ON public.map_pins FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert map pins"
  ON public.map_pins FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update map pins"
  ON public.map_pins FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete map pins"
  ON public.map_pins FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER map_pins_touch_updated_at
  BEFORE UPDATE ON public.map_pins
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
