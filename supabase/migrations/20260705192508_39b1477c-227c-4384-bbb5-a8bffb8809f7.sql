
ALTER TABLE public.cohost_applications
  ADD COLUMN IF NOT EXISTS co_host_agreement_signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS handbook_signature_name text,
  ADD COLUMN IF NOT EXISTS handbook_version text;
