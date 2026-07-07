
REVOKE EXECUTE ON FUNCTION public.log_private_room_booking_status() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_private_room_booking_status() FROM anon;
REVOKE EXECUTE ON FUNCTION public.log_private_room_booking_status() FROM authenticated;
