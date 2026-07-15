
CREATE TABLE public.content_moderation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid REFERENCES public.content_items(id) ON DELETE SET NULL,
  item_title text NOT NULL,
  item_kind text,
  creator_id uuid,
  action text NOT NULL CHECK (action IN ('approved','rejected','pending','deleted')),
  previous_status text,
  notes text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_email text,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX content_moderation_audit_created_at_idx
  ON public.content_moderation_audit (created_at DESC);
CREATE INDEX content_moderation_audit_content_item_id_idx
  ON public.content_moderation_audit (content_item_id, created_at DESC);

GRANT SELECT, INSERT ON public.content_moderation_audit TO authenticated;
GRANT ALL ON public.content_moderation_audit TO service_role;

ALTER TABLE public.content_moderation_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view moderation audit"
  ON public.content_moderation_audit FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert moderation audit"
  ON public.content_moderation_audit FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));
