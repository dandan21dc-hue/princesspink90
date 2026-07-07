
CREATE TABLE public.private_room_booking_status_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  booking_id uuid NOT NULL REFERENCES public.private_room_bookings(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('pending','confirmed','cancelled')),
  note text,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prbse_booking_id ON public.private_room_booking_status_events(booking_id, changed_at);

GRANT SELECT ON public.private_room_booking_status_events TO authenticated;
GRANT ALL ON public.private_room_booking_status_events TO service_role;

ALTER TABLE public.private_room_booking_status_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own booking history"
  ON public.private_room_booking_status_events FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.private_room_bookings b
      WHERE b.id = booking_id AND b.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins view all booking history"
  ON public.private_room_booking_status_events FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Trigger: log status changes
CREATE OR REPLACE FUNCTION public.log_private_room_booking_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.private_room_booking_status_events(booking_id, status, changed_at)
    VALUES (NEW.id, NEW.status, COALESCE(NEW.created_at, now()));
  ELSIF (TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    INSERT INTO public.private_room_booking_status_events(booking_id, status, changed_at)
    VALUES (NEW.id, NEW.status, COALESCE(NEW.updated_at, now()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_log_private_room_booking_status ON public.private_room_bookings;
CREATE TRIGGER trg_log_private_room_booking_status
AFTER INSERT OR UPDATE OF status ON public.private_room_bookings
FOR EACH ROW EXECUTE FUNCTION public.log_private_room_booking_status();

-- Backfill: initial pending event at created_at for every existing booking
INSERT INTO public.private_room_booking_status_events(booking_id, status, changed_at, note)
SELECT b.id, 'pending', b.created_at, 'backfilled'
FROM public.private_room_bookings b
WHERE NOT EXISTS (
  SELECT 1 FROM public.private_room_booking_status_events e
  WHERE e.booking_id = b.id AND e.status = 'pending'
);

-- Backfill: current status event at updated_at for bookings that moved past pending
INSERT INTO public.private_room_booking_status_events(booking_id, status, changed_at, note)
SELECT b.id, b.status, b.updated_at, 'backfilled'
FROM public.private_room_bookings b
WHERE b.status <> 'pending'
  AND NOT EXISTS (
    SELECT 1 FROM public.private_room_booking_status_events e
    WHERE e.booking_id = b.id AND e.status = b.status
  );
