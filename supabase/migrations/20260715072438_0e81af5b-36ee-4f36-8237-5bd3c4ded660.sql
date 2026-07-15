ALTER TABLE public.private_session_slots
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS price_cents integer;

ALTER TABLE public.workspace_slots
  ADD COLUMN IF NOT EXISTS duration_minutes integer,
  ADD COLUMN IF NOT EXISTS price_cents integer;

-- Backfill duration from the existing start/end range so historical rows keep working.
UPDATE public.private_session_slots
   SET duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::int)
 WHERE duration_minutes IS NULL;

UPDATE public.workspace_slots
   SET duration_minutes = GREATEST(1, ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 60)::int)
 WHERE duration_minutes IS NULL;

-- Non-negative guards. Amounts are AUD cents; use a validation trigger only if
-- you need time-dependent checks — a plain CHECK is fine for pure range guards.
ALTER TABLE public.private_session_slots
  DROP CONSTRAINT IF EXISTS private_session_slots_duration_positive,
  ADD CONSTRAINT private_session_slots_duration_positive
    CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  DROP CONSTRAINT IF EXISTS private_session_slots_price_nonneg,
  ADD CONSTRAINT private_session_slots_price_nonneg
    CHECK (price_cents IS NULL OR price_cents >= 0);

ALTER TABLE public.workspace_slots
  DROP CONSTRAINT IF EXISTS workspace_slots_duration_positive,
  ADD CONSTRAINT workspace_slots_duration_positive
    CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  DROP CONSTRAINT IF EXISTS workspace_slots_price_nonneg,
  ADD CONSTRAINT workspace_slots_price_nonneg
    CHECK (price_cents IS NULL OR price_cents >= 0);