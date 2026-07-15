CREATE TABLE public.revenue_splits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  cohost_user_id uuid NOT NULL,
  total_revenue_cents integer NOT NULL DEFAULT 0 CHECK (total_revenue_cents >= 0),
  partner_share_percent numeric(5,2) NOT NULL DEFAULT 50 CHECK (partner_share_percent >= 0 AND partner_share_percent <= 100),
  currency text NOT NULL DEFAULT 'aud',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid')),
  paid_at timestamptz,
  paid_by uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX revenue_splits_event_id_idx ON public.revenue_splits(event_id);
CREATE INDEX revenue_splits_cohost_user_id_idx ON public.revenue_splits(cohost_user_id);
CREATE INDEX revenue_splits_status_idx ON public.revenue_splits(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.revenue_splits TO authenticated;
GRANT ALL ON public.revenue_splits TO service_role;

ALTER TABLE public.revenue_splits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view revenue splits"
  ON public.revenue_splits FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert revenue splits"
  ON public.revenue_splits FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update revenue splits"
  ON public.revenue_splits FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete revenue splits"
  ON public.revenue_splits FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER update_revenue_splits_updated_at
  BEFORE UPDATE ON public.revenue_splits
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();