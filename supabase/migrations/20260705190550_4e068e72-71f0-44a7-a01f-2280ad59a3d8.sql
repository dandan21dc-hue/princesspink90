
ALTER TABLE public.rsvps
  ALTER COLUMN entry_code SET DEFAULT 'PINK-' || nextval('public.rsvp_entry_code_seq')::text;
