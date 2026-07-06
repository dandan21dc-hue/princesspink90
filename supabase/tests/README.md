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

`NOTICE: PASS: …` for each of the nine attendee tamper attempts (all
rejected) and the two positive host/admin attempts (both allowed). Any
`FAIL: …` line is a real regression — the trigger is no longer blocking
that column.
