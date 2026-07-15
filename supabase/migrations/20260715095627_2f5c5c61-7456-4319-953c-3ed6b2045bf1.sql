
ALTER TABLE public.nowpayments_ipn_events
  ADD COLUMN IF NOT EXISTS admin_note text,
  ADD COLUMN IF NOT EXISTS admin_note_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS admin_note_updated_by uuid,
  ADD COLUMN IF NOT EXISTS handled_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS handled_updated_by uuid;
