-- Regression test: rsvps_block_user_field_tamper trigger
--
-- Verifies that an authenticated attendee cannot mutate staff/door-only
-- columns on their own RSVP, while admins and the event host can.
--
-- Uses pgTAP (the framework used by `supabase db test` / pg_prove).
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

-- pgTAP helper: returns TRUE when the statement is blocked (any exception),
-- FALSE when it unexpectedly succeeds.
CREATE OR REPLACE FUNCTION pg_temp.rejects(_uid uuid, _sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(_uid, _sql);
    EXECUTE 'RESET ROLE';
    RETURN false;  -- should have thrown
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN true;   -- blocked as expected
  END;
END $$;

-- pgTAP helper: returns TRUE when the statement succeeds,
-- FALSE when it unexpectedly throws.
CREATE OR REPLACE FUNCTION pg_temp.allows(_uid uuid, _sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM pg_temp.as_user(_uid, _sql);  -- resets role on success
    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    EXECUTE 'RESET ROLE';
    RETURN false;  -- threw unexpectedly
  END;
END $$;

-- ---------------------------------------------------------------------------
-- pgTAP plan: 9 reject + 2 allow = 11 assertions
-- ---------------------------------------------------------------------------
SELECT plan(11);

-- ---------------------------------------------------------------------------
-- Attendee tamper attempts — every one MUST be rejected
-- ---------------------------------------------------------------------------
SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET checked_in_at = now() WHERE id = %L',
           current_setting('test.rsvp'))
  ),
  'attendee cannot self-check-in'
);

SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET checked_in_by = %L WHERE id = %L',
           current_setting('test.attendee'),
           current_setting('test.rsvp'))
  ),
  'attendee cannot set checked_in_by'
);

SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET door_notes = %L WHERE id = %L',
           'forged',
           current_setting('test.rsvp'))
  ),
  'attendee cannot write door_notes'
);

SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET waiver_signature = %L, waiver_accepted_at = now() WHERE id = %L',
           'X',
           current_setting('test.rsvp'))
  ),
  'attendee cannot forge waiver acceptance'
);

SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET entry_code = %L WHERE id = %L',
           'PINK-999999',
           current_setting('test.rsvp'))
  ),
  'attendee cannot rewrite entry_code'
);

SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET entry_phrase = %L WHERE id = %L',
           'Chosen Phrase',
           current_setting('test.rsvp'))
  ),
  'attendee cannot rewrite entry_phrase'
);

SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET ticket_code = %L WHERE id = %L',
           'FAKE',
           current_setting('test.rsvp'))
  ),
  'attendee cannot rewrite ticket_code'
);

SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET event_id = %L WHERE id = %L',
           gen_random_uuid(),
           current_setting('test.rsvp'))
  ),
  'attendee cannot move rsvp to a different event'
);

SELECT ok(
  pg_temp.rejects(
    current_setting('test.attendee')::uuid,
    format('UPDATE public.rsvps SET user_id = %L WHERE id = %L',
           gen_random_uuid(),
           current_setting('test.rsvp'))
  ),
  'attendee cannot reassign rsvp ownership'
);

-- ---------------------------------------------------------------------------
-- Host and admin attempts — MUST succeed
-- ---------------------------------------------------------------------------
SELECT ok(
  pg_temp.allows(
    current_setting('test.host')::uuid,
    format('UPDATE public.rsvps SET checked_in_at = now(), checked_in_by = %L WHERE id = %L',
           current_setting('test.host'),
           current_setting('test.rsvp'))
  ),
  'event host can check attendee in'
);

SELECT ok(
  pg_temp.allows(
    current_setting('test.admin')::uuid,
    format('UPDATE public.rsvps SET door_notes = %L WHERE id = %L',
           'VIP',
           current_setting('test.rsvp'))
  ),
  'admin can annotate door_notes'
);

SELECT finish();

-- Roll everything back so the test leaves no residue.
ROLLBACK;
