-- Add co_host to app_role enum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'co_host'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'co_host';
  END IF;
END $$;

-- Grant admin to dandan21.dc@gmail.com
INSERT INTO public.user_roles (user_id, role)
SELECT u.id, 'admin'::public.app_role
FROM auth.users u
WHERE u.email = 'dandan21.dc@gmail.com'
ON CONFLICT (user_id, role) DO NOTHING;

-- Ensure users can read their own roles (for the client-side guard fetch)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='user_roles' AND policyname='Users read own roles'
  ) THEN
    CREATE POLICY "Users read own roles" ON public.user_roles
      FOR SELECT TO authenticated
      USING (auth.uid() = user_id);
  END IF;
END $$;