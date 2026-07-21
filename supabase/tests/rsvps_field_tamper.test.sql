-- Regression test: rsvps_block_user_field_tamper trigger
--
-- Verifies that an authenticated attendee cannot mutate staff/door-only
-- columns on their own RSVP, while admins and the event host can.
--
-- HOW TO RUN
--   Local (recommended):    supabase db test
--   Ad-hoc against a branch: psql "$DIRECT_DB_URL" -v ON_ERROR_STOP=1 \
--                              -f supabase/tests/rsvps_field_tamper.test.sql
--
-- The connecting role MUST be able to INSERT into auth.users (postgres
-- superuser in local dev, or the direct service-role DB URL on a branch).
-- The whole run is wrapped in a transaction that ROLLBACKs at the end,
-- so it never leaves fixtures behind.



BEGIN;

-- Emit TAP output so `supabase db test`/pg_prove can parse this script.
SELECT plan(11);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_attendee uuid := gen_random_uuid();
  v_host     uuid := gen_random_uuid();
  v_admin    uuid := gen_random_uuid();
  v_event    uuid;
  v_rsvp     uuid;
BEGIN
  -- Seed real auth.users rows so FK constraints on events/rsvps/user_roles hold.
  -- Everything is rolled back at the end of the script.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  VALUES
    (v_attendee, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     v_attendee::text || '@test.local', '', now(), now(), now()),
    (v_host,     '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     v_host::text     || '@test.local', '', now(), now(), now()),
    (v_admin,    '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     v_admin::text    || '@test.local', '', now(), now(), now());

  -- Seed a host-owned event and an attendee RSVP as the service role.
  INSERT INTO public.events (id, host_id, title, venue_name, starts_at, published)
  VALUES (gen_random_uuid(), v_host, 'tamper-test event', 'test venue', now() + interval '1 day', true)
  RETURNING id INTO v_event;

  INSERT INTO public.rsvps (id, event_id, user_id, status)
  VALUES (gen_random_uuid(), v_event, v_attendee, 'confirmed')
  RETURNING id INTO v_rsvp;

  INSERT INTO public.user_roles (user_id, role) VALUES (v_admin, 'admin');

  -- Stash ids for the assertion blocks below.
  PERFORM set_config('test.attendee', v_attendee::text, true);
  PERFORM set_config('test.host',     v_host::text,     true);
  PERFORM set_config('test.admin',    v_admin::text,    true);
  PERFORM set_config('test.rsvp',     v_rsvp::text,     true);
  PERFORM set_config('test.event',    v_event::text,    true);
END $$;

-- Helper: run a statement as `authenticated` with a spoofed auth.uid().
-- auth.uid() reads request.jwt.claim.sub, so setting that + role is enough
-- to trip the trigger's SECURITY DEFINER check exactly like a live request.
CREATE OR REPLACE FUNCTION pg_temp.as_user(_uid uuid, _sql text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims',
                     json_build_object('sub', _uid::text, 'role', 'authenticated')::text,
                     true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  EXECUTE _sql;
  EXECUTE 'RESET ROLE';
END $$;

-- Assertion helper: expect the statement to fail with the tamper message.
CREATE OR REPLACE FUNCTION pg_temp.expect_reject(_uid uuid, _sql text, _label text) RETURNS text
LANGUAGE plpgsql AS $$
DECLARE
  v_result text;
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(_uid, _sql);
    v_result := fail(format('%s — attendee update was NOT blocked', _label));
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      v_result := pass(format('%s — trigger rejected as expected (%s)', _label, SQLERRM));
    WHEN insufficient_privilege THEN
      v_result := pass(format('%s — rejected by RLS/privilege (%s)', _label, SQLERRM));
  END;
  EXECUTE 'RESET ROLE';
  RETURN v_result;
END $$;

-- Assertion helper: expect the statement to succeed.
CREATE OR REPLACE FUNCTION pg_temp.expect_allow(_uid uuid, _sql text, _label text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_uid, _sql);
  RETURN pass(format('%s — update allowed as expected', _label));
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RETURN fail(format('%s — expected success but got: %s', _label, SQLERRM));
END $$;

-- ---------------------------------------------------------------------------
-- Attendee attempts — every one MUST be rejected
-- ---------------------------------------------------------------------------
WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET checked_in_at = now() WHERE id = %L', rsvp),
  'attendee cannot self-check-in')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET checked_in_by = %L WHERE id = %L', attendee, rsvp),
  'attendee cannot set checked_in_by')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET door_notes = ''forged'' WHERE id = %L', rsvp),
  'attendee cannot write door_notes')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET waiver_signature = ''X'', waiver_accepted_at = now() WHERE id = %L', rsvp),
  'attendee cannot forge waiver acceptance')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET entry_code = ''PINK-999999'' WHERE id = %L', rsvp),
  'attendee cannot rewrite entry_code')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET entry_phrase = ''Chosen Phrase'' WHERE id = %L', rsvp),
  'attendee cannot rewrite entry_phrase')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET ticket_code = ''FAKE'' WHERE id = %L', rsvp),
  'attendee cannot rewrite ticket_code')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET event_id = %L WHERE id = %L', gen_random_uuid(), rsvp),
  'attendee cannot move rsvp to a different event')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.attendee')::uuid AS attendee,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_reject(attendee,
  format('UPDATE public.rsvps SET user_id = %L WHERE id = %L', gen_random_uuid(), rsvp),
  'attendee cannot reassign rsvp ownership')
FROM vars;

-- ---------------------------------------------------------------------------
-- Host and admin attempts — MUST succeed
-- ---------------------------------------------------------------------------
WITH vars AS (
  SELECT
    current_setting('test.host')::uuid AS host_id,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_allow(host_id,
  format('UPDATE public.rsvps SET checked_in_at = now(), checked_in_by = %L WHERE id = %L', host_id, rsvp),
  'event host can check attendee in')
FROM vars;

WITH vars AS (
  SELECT
    current_setting('test.admin')::uuid AS admin_id,
    current_setting('test.rsvp')::uuid AS rsvp
)
SELECT pg_temp.expect_allow(admin_id,
  format('UPDATE public.rsvps SET door_notes = ''VIP'' WHERE id = %L', rsvp),
  'admin can annotate door_notes')
FROM vars;

SELECT * FROM finish();

-- Roll everything back so the test leaves no residue.
ROLLBACK;
