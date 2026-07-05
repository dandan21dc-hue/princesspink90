CREATE TABLE public.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'lifetime',
  stripe_session_id text UNIQUE,
  amount_cents integer,
  environment text NOT NULL DEFAULT 'sandbox',
  event_ticket_used_at timestamptz,
  event_ticket_event_id uuid REFERENCES public.events(id) ON DELETE SET NULL,
  private_session_requested_at timestamptz,
  private_session_fulfilled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_memberships_user ON public.memberships(user_id);
CREATE UNIQUE INDEX idx_memberships_user_kind_env
  ON public.memberships(user_id, kind, environment);

GRANT SELECT, UPDATE ON public.memberships TO authenticated;
GRANT ALL ON public.memberships TO service_role;

ALTER TABLE public.memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own membership"
  ON public.memberships FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users update own membership perks"
  ON public.memberships FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER touch_memberships_updated
  BEFORE UPDATE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Extend content access rule: lifetime members unlock everything
CREATE OR REPLACE FUNCTION public.user_can_access_content(
  _user_id uuid, _content_id uuid, _env text DEFAULT 'sandbox'::text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT
    _user_id IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.content_purchases
        WHERE user_id = _user_id
          AND content_item_id = _content_id
          AND environment = _env
      )
      OR EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE user_id = _user_id
          AND environment = _env
          AND status IN ('active','trialing','past_due')
          AND (current_period_end IS NULL OR current_period_end > now())
      )
      OR EXISTS (
        SELECT 1 FROM public.memberships
        WHERE user_id = _user_id
          AND kind = 'lifetime'
          AND environment = _env
      )
      OR EXISTS (
        SELECT 1 FROM public.content_items ci
        WHERE ci.id = _content_id AND ci.creator_id = _user_id
      )
    );
$$;