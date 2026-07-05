-- Add 'cohost' role
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'cohost';

-- Applications table
CREATE TABLE public.cohost_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  age int NOT NULL,
  city text NOT NULL,
  instagram_handle text,
  other_socials text,
  hosting_experience text NOT NULL,
  why_join text NOT NULL,
  availability text,
  event_types text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','withdrawn')),
  admin_notes text,
  reviewed_by uuid REFERENCES auth.users(id),
  reviewed_at timestamptz,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.cohost_applications TO authenticated;
GRANT ALL ON public.cohost_applications TO service_role;

ALTER TABLE public.cohost_applications ENABLE ROW LEVEL SECURITY;

-- Users see and manage only their own row
CREATE POLICY "Users view own cohost application"
  ON public.cohost_applications FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users insert own cohost application"
  ON public.cohost_applications FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own pending application"
  ON public.cohost_applications FOR UPDATE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Users delete own pending application"
  ON public.cohost_applications FOR DELETE TO authenticated
  USING (auth.uid() = user_id AND status = 'pending');

-- Admins view/manage all
CREATE POLICY "Admins view all cohost applications"
  ON public.cohost_applications FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins update cohost applications"
  ON public.cohost_applications FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE TRIGGER cohost_applications_touch
  BEFORE UPDATE ON public.cohost_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();