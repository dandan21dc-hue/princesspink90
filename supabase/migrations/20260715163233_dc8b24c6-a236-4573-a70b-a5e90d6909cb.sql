ALTER TABLE public.user_rewards REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_rewards;