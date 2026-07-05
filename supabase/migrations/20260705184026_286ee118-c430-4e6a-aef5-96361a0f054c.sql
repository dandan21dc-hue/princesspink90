CREATE TABLE IF NOT EXISTS public.venue_compliance_reminder_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.venue_compliance_documents(id) ON DELETE CASCADE,
  kind venue_compliance_kind NOT NULL,
  reminder_type text NOT NULL DEFAULT 'expiry_30_day',
  expires_on date NOT NULL,
  recipients jsonb NOT NULL DEFAULT '[]'::jsonb,
  channels jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'sent',
  error_message text,
  idempotency_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT venue_compliance_reminder_log_idempotency_key_unique UNIQUE (idempotency_key)
);

GRANT SELECT ON public.venue_compliance_reminder_log TO authenticated;
GRANT ALL ON public.venue_compliance_reminder_log TO service_role;

ALTER TABLE public.venue_compliance_reminder_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view venue compliance reminder log"
  ON public.venue_compliance_reminder_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE INDEX IF NOT EXISTS idx_vcr_log_document ON public.venue_compliance_reminder_log(document_id);
CREATE INDEX IF NOT EXISTS idx_vcr_log_created_at ON public.venue_compliance_reminder_log(created_at DESC);

ALTER TABLE public.venue_compliance_documents
  ADD COLUMN IF NOT EXISTS expiry_reminder_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_vcd_expiry_reminder_scan
  ON public.venue_compliance_documents(expires_on)
  WHERE expiry_reminder_sent_at IS NULL AND expires_on IS NOT NULL;