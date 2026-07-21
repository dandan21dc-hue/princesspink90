# Database regression tests

## `rsvps_field_tamper.test.sql`

Locks in the guarantee that attendees cannot forge check-in, waiver, entry
code, or ticket code fields on their own RSVP. Exercises every column
protected by the `rsvps_block_user_field_tamper` trigger, plus positive
cases confirming the event host and admins can still write those fields.

### Run it locally

```bash
supabase db test
```

`supabase db test` starts the local stack (if not already running) and
executes every `*.test.sql` in this directory as the postgres superuser,
which can seed the `auth.users` rows the test needs.
Each test script must emit TAP output (`plan(...)` / `finish()`) so
`supabase db test` (which runs `pg_prove` internally) can report pass/fail
correctly in CI.

### Run it against a branch / CI

Use the direct service-role connection string (not the pooled one) so the
role has permission to write to `auth.users`:

```bash
psql "$DIRECT_DB_URL" -v ON_ERROR_STOP=1 \
  -f supabase/tests/rsvps_field_tamper.test.sql
```

Every fixture is created inside a single transaction that ends in
`ROLLBACK`, so a passing or failing run leaves no residue in the database.

### What "pass" looks like

`supabase db test` should print eleven TAP assertions (`ok 1` through
`ok 11`) covering the nine attendee tamper attempts plus the two
host/admin positive cases. Any `not ok` line is a real regression — the
trigger is no longer blocking that column.
