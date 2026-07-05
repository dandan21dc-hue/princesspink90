
CREATE TABLE public.private_room_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes IN (30, 60)),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  stripe_session_id text UNIQUE,
  amount_cents integer,
  currency text NOT NULL DEFAULT 'aud',
  environment text NOT NULL DEFAULT 'sandbox',
  customer_email text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prb_starts_at ON public.private_room_bookings(starts_at);
CREATE INDEX idx_prb_user_id ON public.private_room_bookings(user_id);
CREATE INDEX idx_prb_status ON public.private_room_bookings(status);

GRANT SELECT, INSERT ON public.private_room_bookings TO authenticated;
GRANT ALL ON public.private_room_bookings TO service_role;

ALTER TABLE public.private_room_bookings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bookings"
  ON public.private_room_bookings FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can create own bookings"
  ON public.private_room_bookings FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND status = 'pending');

CREATE TRIGGER trg_private_room_bookings_updated
  BEFORE UPDATE ON public.private_room_bookings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Public availability lookup: returns busy time ranges without exposing PII.
-- Includes confirmed bookings and pending bookings held for the last 15 minutes.
CREATE OR REPLACE FUNCTION public.get_private_room_busy(
  from_ts timestamptz,
  to_ts timestamptz
)
RETURNS TABLE(starts_at timestamptz, duration_minutes integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.starts_at, b.duration_minutes
  FROM public.private_room_bookings b
  WHERE b.starts_at < to_ts
    AND (b.starts_at + (b.duration_minutes || ' minutes')::interval) > from_ts
    AND (
      b.status = 'confirmed'
      OR (b.status = 'pending' AND b.created_at > now() - interval '15 minutes')
    );
$$;

GRANT EXECUTE ON FUNCTION public.get_private_room_busy(timestamptz, timestamptz) TO anon, authenticated;
