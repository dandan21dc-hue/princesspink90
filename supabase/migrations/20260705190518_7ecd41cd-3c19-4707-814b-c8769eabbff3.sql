
CREATE SEQUENCE IF NOT EXISTS public.rsvp_entry_code_seq START WITH 101 MINVALUE 101;

ALTER TABLE public.rsvps ADD COLUMN entry_code text UNIQUE;

CREATE OR REPLACE FUNCTION public.rsvps_assign_entry_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.entry_code IS NULL THEN
    NEW.entry_code := 'PINK-' || nextval('public.rsvp_entry_code_seq')::text;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER rsvps_assign_entry_code_trg
  BEFORE INSERT ON public.rsvps
  FOR EACH ROW EXECUTE FUNCTION public.rsvps_assign_entry_code();

-- Backfill existing rows in creation order.
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.rsvps
  WHERE entry_code IS NULL
)
UPDATE public.rsvps r
SET entry_code = 'PINK-' || (100 + o.rn)::text
FROM ordered o
WHERE r.id = o.id;

-- Advance the sequence past any backfilled values.
SELECT setval(
  'public.rsvp_entry_code_seq',
  GREATEST(101, (SELECT COALESCE(MAX(substring(entry_code from 'PINK-(\d+)')::int), 100) FROM public.rsvps) + 1),
  false
);

ALTER TABLE public.rsvps ALTER COLUMN entry_code SET NOT NULL;
