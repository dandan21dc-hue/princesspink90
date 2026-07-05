
-- content_items
CREATE TABLE public.content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('photo_set','video','bundle')),
  title text NOT NULL,
  description text,
  cover_url text,
  price_cents integer,
  subscribers_only boolean NOT NULL DEFAULT false,
  media_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
  published boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.content_items TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.content_items TO authenticated;
GRANT ALL ON public.content_items TO service_role;
ALTER TABLE public.content_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published items are viewable by everyone"
  ON public.content_items FOR SELECT
  USING (published = true);
CREATE POLICY "Creators view all their items"
  ON public.content_items FOR SELECT
  TO authenticated
  USING (auth.uid() = creator_id);
CREATE POLICY "Creators insert their items"
  ON public.content_items FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creators update their items"
  ON public.content_items FOR UPDATE
  TO authenticated
  USING (auth.uid() = creator_id)
  WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creators delete their items"
  ON public.content_items FOR DELETE
  TO authenticated
  USING (auth.uid() = creator_id);

CREATE TRIGGER content_items_touch BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- content_purchases
CREATE TABLE public.content_purchases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  content_item_id uuid NOT NULL REFERENCES public.content_items(id) ON DELETE CASCADE,
  stripe_session_id text UNIQUE,
  amount_cents integer NOT NULL,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, content_item_id, environment)
);
GRANT SELECT ON public.content_purchases TO authenticated;
GRANT ALL ON public.content_purchases TO service_role;
ALTER TABLE public.content_purchases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own purchases"
  ON public.content_purchases FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_content_purchases_user ON public.content_purchases(user_id);
CREATE INDEX idx_content_purchases_item ON public.content_purchases(content_item_id);

-- subscriptions
CREATE TABLE public.subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  stripe_subscription_id text NOT NULL UNIQUE,
  stripe_customer_id text NOT NULL,
  product_id text NOT NULL,
  price_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean DEFAULT false,
  environment text NOT NULL DEFAULT 'sandbox',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.subscriptions TO authenticated;
GRANT ALL ON public.subscriptions TO service_role;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users view own subscription"
  ON public.subscriptions FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_subscriptions_user ON public.subscriptions(user_id);
CREATE INDEX idx_subscriptions_stripe_id ON public.subscriptions(stripe_subscription_id);

-- entitlement helper
CREATE OR REPLACE FUNCTION public.user_can_access_content(
  _user_id uuid,
  _content_id uuid,
  _env text DEFAULT 'sandbox'
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
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
        SELECT 1 FROM public.content_items ci
        WHERE ci.id = _content_id AND ci.creator_id = _user_id
      )
    );
$$;

-- Storage policies for content-media (private): only owner (uploader) manages;
-- viewing happens via server-generated signed URLs (service role bypasses RLS).
CREATE POLICY "Users manage own media uploads (select)"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'content-media' AND auth.uid() = owner);
CREATE POLICY "Users upload to content-media"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'content-media' AND auth.uid() = owner);
CREATE POLICY "Users delete own content-media"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'content-media' AND auth.uid() = owner);
