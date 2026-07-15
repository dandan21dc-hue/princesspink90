
REVOKE ALL ON FUNCTION public.revoke_entitlement_by_payment_reference(text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_entitlement_by_payment_reference(text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.revoke_entitlement_by_payment_reference(text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_entitlement_by_payment_reference(text, text, text) TO service_role;
