ALTER TABLE public.age_verifications
  ADD COLUMN IF NOT EXISTS selfie_file_path text,
  ADD COLUMN IF NOT EXISTS adult_content_release boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS adult_content_release_at timestamptz,
  ADD COLUMN IF NOT EXISTS adult_content_release_version text;