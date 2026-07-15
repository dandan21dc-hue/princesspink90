
CREATE TABLE public.admin_assistant_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL,
  title text NOT NULL DEFAULT 'New conversation',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_assistant_threads_admin_updated_idx
  ON public.admin_assistant_threads(admin_id, updated_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_assistant_threads TO authenticated;
GRANT ALL ON public.admin_assistant_threads TO service_role;

ALTER TABLE public.admin_assistant_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aat_admin_select" ON public.admin_assistant_threads
  FOR SELECT TO authenticated
  USING (admin_id = auth.uid() AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "aat_admin_insert" ON public.admin_assistant_threads
  FOR INSERT TO authenticated
  WITH CHECK (admin_id = auth.uid() AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "aat_admin_update" ON public.admin_assistant_threads
  FOR UPDATE TO authenticated
  USING (admin_id = auth.uid() AND public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (admin_id = auth.uid() AND public.has_role(auth.uid(), 'admin'::app_role));
CREATE POLICY "aat_admin_delete" ON public.admin_assistant_threads
  FOR DELETE TO authenticated
  USING (admin_id = auth.uid() AND public.has_role(auth.uid(), 'admin'::app_role));


CREATE TABLE public.admin_assistant_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES public.admin_assistant_threads(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  role text NOT NULL CHECK (role IN ('user','assistant','system')),
  parts jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (thread_id, client_id)
);
CREATE INDEX admin_assistant_messages_thread_created_idx
  ON public.admin_assistant_messages(thread_id, created_at ASC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_assistant_messages TO authenticated;
GRANT ALL ON public.admin_assistant_messages TO service_role;

ALTER TABLE public.admin_assistant_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "aam_admin_select" ON public.admin_assistant_messages
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_assistant_threads t
    WHERE t.id = thread_id
      AND t.admin_id = auth.uid()
      AND public.has_role(auth.uid(), 'admin'::app_role)
  ));
CREATE POLICY "aam_admin_insert" ON public.admin_assistant_messages
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.admin_assistant_threads t
    WHERE t.id = thread_id
      AND t.admin_id = auth.uid()
      AND public.has_role(auth.uid(), 'admin'::app_role)
  ));
CREATE POLICY "aam_admin_delete" ON public.admin_assistant_messages
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.admin_assistant_threads t
    WHERE t.id = thread_id
      AND t.admin_id = auth.uid()
      AND public.has_role(auth.uid(), 'admin'::app_role)
  ));
