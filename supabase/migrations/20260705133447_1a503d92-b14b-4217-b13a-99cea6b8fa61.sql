ALTER TABLE public.event_access_codes
  ADD COLUMN used_at timestamptz,
  ADD COLUMN used_by_name text;