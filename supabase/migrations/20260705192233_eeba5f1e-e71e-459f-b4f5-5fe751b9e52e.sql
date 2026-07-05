
CREATE TABLE public.cohost_handbook_acknowledgements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  handbook_version text NOT NULL DEFAULT '1.0',
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.cohost_handbook_acknowledgements TO authenticated;
GRANT ALL ON public.cohost_handbook_acknowledgements TO service_role;

ALTER TABLE public.cohost_handbook_acknowledgements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own handbook ack"
  ON public.cohost_handbook_acknowledgements FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins read all handbook acks"
  ON public.cohost_handbook_acknowledgements FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users create own handbook ack"
  ON public.cohost_handbook_acknowledgements FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);
