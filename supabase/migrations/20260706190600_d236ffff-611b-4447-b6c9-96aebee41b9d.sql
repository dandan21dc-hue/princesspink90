
DROP POLICY IF EXISTS "user updates own rsvp" ON public.rsvps;
CREATE POLICY "user updates own rsvp"
ON public.rsvps
FOR UPDATE
TO authenticated
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);
