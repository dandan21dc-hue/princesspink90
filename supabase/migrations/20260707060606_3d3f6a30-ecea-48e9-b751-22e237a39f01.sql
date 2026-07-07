
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'pending'
    CHECK (moderation_status IN ('pending','approved','rejected')),
  ADD COLUMN IF NOT EXISTS moderation_notes text,
  ADD COLUMN IF NOT EXISTS moderation_reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderation_reviewed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS moderation_submitted_at timestamp with time zone NOT NULL DEFAULT now();

-- Existing rows created before this feature are treated as approved so the
-- store isn't wiped when this ships.
UPDATE public.content_items
  SET moderation_status = 'approved',
      moderation_reviewed_at = COALESCE(moderation_reviewed_at, created_at)
  WHERE moderation_status = 'pending' AND created_at < now();

CREATE INDEX IF NOT EXISTS content_items_moderation_status_idx
  ON public.content_items (moderation_status);

-- Tighten the public read policy: only published AND approved items are
-- visible to non-authors.
DROP POLICY IF EXISTS "Published items are viewable by everyone" ON public.content_items;
CREATE POLICY "Published approved items are viewable by everyone"
  ON public.content_items FOR SELECT
  USING (published = true AND moderation_status = 'approved');

-- Admins can read every item regardless of state.
DROP POLICY IF EXISTS "Admins can view all content items" ON public.content_items;
CREATE POLICY "Admins can view all content items"
  ON public.content_items FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Admins can update moderation state on any item.
DROP POLICY IF EXISTS "Admins can moderate content items" ON public.content_items;
CREATE POLICY "Admins can moderate content items"
  ON public.content_items FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- Block non-admin creators from self-approving. Creators may still edit
-- their own item (existing policy), but any change to moderation_* fields
-- by a non-admin is rejected.
CREATE OR REPLACE FUNCTION public.content_items_block_self_moderation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    IF NEW.moderation_status IS DISTINCT FROM OLD.moderation_status
       OR NEW.moderation_notes IS DISTINCT FROM OLD.moderation_notes
       OR NEW.moderation_reviewed_by IS DISTINCT FROM OLD.moderation_reviewed_by
       OR NEW.moderation_reviewed_at IS DISTINCT FROM OLD.moderation_reviewed_at THEN
      RAISE EXCEPTION 'Only admins can change moderation state on content items';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS content_items_block_self_moderation ON public.content_items;
CREATE TRIGGER content_items_block_self_moderation
  BEFORE UPDATE ON public.content_items
  FOR EACH ROW EXECUTE FUNCTION public.content_items_block_self_moderation();
