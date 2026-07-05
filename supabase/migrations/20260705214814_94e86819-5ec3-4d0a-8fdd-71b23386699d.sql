ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS expires_at timestamptz;
ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS term_months integer;
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_stripe_session_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS memberships_stripe_session_id_unique ON public.memberships (stripe_session_id) WHERE stripe_session_id IS NOT NULL;