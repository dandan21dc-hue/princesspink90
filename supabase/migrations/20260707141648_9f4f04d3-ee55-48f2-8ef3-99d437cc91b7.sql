
DO $$ BEGIN
  CREATE TYPE public.verification_status AS ENUM ('unverified','pending','approved','declined');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status public.verification_status NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS veriff_session_id text,
  ADD COLUMN IF NOT EXISTS consents_to_recording boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS profiles_veriff_session_id_idx
  ON public.profiles (veriff_session_id)
  WHERE veriff_session_id IS NOT NULL;
