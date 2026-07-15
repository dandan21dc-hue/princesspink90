
CREATE TABLE public.concierge_chat_history (
  user_id UUID NOT NULL PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.concierge_chat_history TO authenticated;
GRANT ALL ON public.concierge_chat_history TO service_role;

ALTER TABLE public.concierge_chat_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage their own concierge history"
  ON public.concierge_chat_history
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER concierge_chat_history_touch_updated_at
  BEFORE UPDATE ON public.concierge_chat_history
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
