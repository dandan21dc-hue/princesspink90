-- Regression test: rsvps_block_user_field_tamper trigger
--
-- Verifies that an authenticated attendee cannot mutate staff/door-only
-- columns on their own RSVP, while admins and the event host can.
--
-- Run:
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rsvps_field_tamper.test.sql
--
-- The script is idempotent: everything runs inside a transaction that is
-- rolled back at the end, so it never leaves data behind.

BEGIN;

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
CREATE OR REPLACE FUNCTION pg_temp.expect_reject(_uid uuid, _sql text, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(_uid, _sql);
    RAISE EXCEPTION 'FAIL: % — attendee update was NOT blocked', _label;
  EXCEPTION
    WHEN raise_exception THEN
      IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;
      RAISE NOTICE 'PASS: % — trigger rejected as expected (%)', _label, SQLERRM;
    WHEN insufficient_privilege THEN
      RAISE NOTICE 'PASS: % — rejected by RLS/privilege (%)', _label, SQLERRM;
  END;
  EXECUTE 'RESET ROLE';
END $$;

-- Assertion helper: expect the statement to succeed.
CREATE OR REPLACE FUNCTION pg_temp.expect_allow(_uid uuid, _sql text, _label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_temp.as_user(_uid, _sql);
  RAISE NOTICE 'PASS: % — update allowed as expected', _label;
EXCEPTION WHEN OTHERS THEN
  EXECUTE 'RESET ROLE';
  RAISE EXCEPTION 'FAIL: % — expected success but got: %', _label, SQLERRM;
END $$;

-- ---------------------------------------------------------------------------
-- Attendee attempts — every one MUST be rejected
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_attendee uuid := current_setting('test.attendee')::uuid;
  v_rsvp     uuid := current_setting('test.rsvp')::uuid;
  v_event    uuid := current_setting('test.event')::uuid;
BEGIN
  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET checked_in_at = now() WHERE id = %L', v_rsvp),
    'attendee cannot self-check-in');

  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET checked_in_by = %L WHERE id = %L', v_attendee, v_rsvp),
    'attendee cannot set checked_in_by');

  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET door_notes = ''forged'' WHERE id = %L', v_rsvp),
    'attendee cannot write door_notes');

  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET waiver_signature = ''X'', waiver_accepted_at = now() WHERE id = %L', v_rsvp),
    'attendee cannot forge waiver acceptance');

  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET entry_code = ''PINK-999999'' WHERE id = %L', v_rsvp),
    'attendee cannot rewrite entry_code');

  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET entry_phrase = ''Chosen Phrase'' WHERE id = %L', v_rsvp),
    'attendee cannot rewrite entry_phrase');

  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET ticket_code = ''FAKE'' WHERE id = %L', v_rsvp),
    'attendee cannot rewrite ticket_code');

  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET event_id = %L WHERE id = %L', gen_random_uuid(), v_rsvp),
    'attendee cannot move rsvp to a different event');

  PERFORM pg_temp.expect_reject(v_attendee,
    format('UPDATE public.rsvps SET user_id = %L WHERE id = %L', gen_random_uuid(), v_rsvp),
    'attendee cannot reassign rsvp ownership');
END $$;

-- ---------------------------------------------------------------------------
-- Host and admin attempts — MUST succeed
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_host  uuid := current_setting('test.host')::uuid;
  v_admin uuid := current_setting('test.admin')::uuid;
  v_rsvp  uuid := current_setting('test.rsvp')::uuid;
BEGIN
  PERFORM pg_temp.expect_allow(v_host,
    format('UPDATE public.rsvps SET checked_in_at = now(), checked_in_by = %L WHERE id = %L', v_host, v_rsvp),
    'event host can check attendee in');

  PERFORM pg_temp.expect_allow(v_admin,
    format('UPDATE public.rsvps SET door_notes = ''VIP'' WHERE id = %L', v_rsvp),
    'admin can annotate door_notes');
END $$;

-- Roll everything back so the test leaves no residue.
ROLLBACK;
