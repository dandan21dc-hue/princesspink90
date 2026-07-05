ALTER TABLE public.events
  ADD COLUMN IF NOT EXISTS permits_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS permit_details text,
  ADD COLUMN IF NOT EXISTS insurance_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS insurance_provider text,
  ADD COLUMN IF NOT EXISTS insurance_policy_number text,
  ADD COLUMN IF NOT EXISTS insurance_expires_on date,
  ADD COLUMN IF NOT EXISTS legal_capacity integer,
  ADD COLUMN IF NOT EXISTS capacity_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS compliance_notes text;
