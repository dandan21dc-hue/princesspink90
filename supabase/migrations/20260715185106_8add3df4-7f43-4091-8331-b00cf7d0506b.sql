
REVOKE EXECUTE ON FUNCTION public.notify_send_receipt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.notify_send_receipt() TO service_role;
