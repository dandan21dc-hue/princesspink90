ALTER TABLE public.private_room_bookings REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.private_room_bookings;