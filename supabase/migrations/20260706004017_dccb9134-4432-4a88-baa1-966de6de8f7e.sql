-- 1. site_settings: restrict SELECT to authenticated (was USING (true) for all roles)
DROP POLICY IF EXISTS "Anyone can read site settings" ON public.site_settings;
CREATE POLICY "Authenticated users can read site settings"
  ON public.site_settings FOR SELECT
  TO authenticated
  USING (true);
REVOKE SELECT ON public.site_settings FROM anon;

-- 2. compliance_policy_versions: restrict SELECT to authenticated
DROP POLICY IF EXISTS "Anyone can read policy versions" ON public.compliance_policy_versions;
CREATE POLICY "Authenticated users can read policy versions"
  ON public.compliance_policy_versions FOR SELECT
  TO authenticated
  USING (true);
REVOKE SELECT ON public.compliance_policy_versions FROM anon;

-- 3. private_room_bookings: add admin SELECT + UPDATE policies (fixes missing admin management)
CREATE POLICY "Admins can view all bookings"
  ON public.private_room_bookings FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can update bookings"
  ON public.private_room_bookings FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "Admins can delete bookings"
  ON public.private_room_bookings FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));