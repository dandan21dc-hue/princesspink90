-- Harden Supabase Realtime for private_room_bookings.
--
-- Rationale (finding: private_room_bookings realtime broadcast risk)
-- ------------------------------------------------------------------
-- The `supabase_realtime` publication was broadcasting every column of
-- public.private_room_bookings, including customer_email,
-- external_payment_reference, amount_cents, notes. RLS SELECT policies
-- currently scope broadcasts to the owner/admin, but any future policy
-- change that broadens SELECT would immediately widen the realtime
-- surface too — a single bad policy could stream customer PII and
-- payment references to unrelated users.
--
-- Defense in depth:
--   1. Remove the table from the realtime publication entirely — no
--      client currently subscribes to it, so removal is safe today.
--   2. If future work needs realtime here, re-add with an explicit
--      column allowlist AND a row filter, e.g.:
--        ALTER PUBLICATION supabase_realtime
--          ADD TABLE public.private_room_bookings
--          (id, user_id, starts_at, duration_minutes, status)
--          WHERE (status = 'confirmed');
--      The static regression scanner
--      (scripts/security-regression-scan.mjs) blocks any migration that
--      adds this table to the publication without a column list.
--   3. A COMMENT on the table records the invariant so future editors
--      (and reviewers) see the rule inline.

ALTER PUBLICATION supabase_realtime DROP TABLE public.private_room_bookings;

COMMENT ON TABLE public.private_room_bookings IS
  'Sensitive: contains customer_email, external_payment_reference, amount_cents, notes. If ever re-added to the supabase_realtime publication, MUST use an explicit column allowlist (id, user_id, starts_at, duration_minutes, status) and a row filter (status = ''confirmed''). Enforced by scripts/security-regression-scan.mjs.';