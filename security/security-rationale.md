# Security Rationale — Accepted SECURITY DEFINER Functions

This document explains why specific database functions in this project are
intentionally declared `SECURITY DEFINER` and, in some cases, executable by
`anon` / `authenticated`. Each entry is cross-referenced from
`@security-memory` and from the CI allowlist in
`scripts/supabase-security-lint.mjs` (`APPROVED_ALLOWLIST`).

All functions listed here explicitly set `search_path` (typically
`SET search_path = public`) to prevent search-path hijacking — the linter's
"Function Search Path Mutable" warning does not apply once `SET search_path`
is present in the function definition. Any function flagged for a mutable
search path that is NOT in this document must be fixed, not accepted.

---

## Why `SECURITY DEFINER` at all?

`SECURITY DEFINER` runs the function with the privileges of the function's
owner instead of the caller. We use it in three narrow cases:

1. **RLS helpers that policies themselves depend on.** If the helper ran as
   the caller, evaluating a policy would re-enter the same policy chain and
   either recurse infinitely or require granting the caller direct SELECT
   on privileged tables (e.g. `user_roles`), which is exactly what RLS is
   protecting.
2. **Queue / background primitives** invoked by `pg_cron`, `pg_net`, or
   webhook handlers that must access `pgmq`, `cron`, `net`, or `vault`
   schemas — schemas that are deliberately not exposed to the Data API.
3. **Idempotent grant / audit RPCs** invoked from verified server code
   (NOWPayments webhook, receipt trigger, etc.) that must write across
   multiple tables atomically without depending on the caller's row-level
   permissions.

For every function below, the risk of `SECURITY DEFINER` is bounded by:
- an explicit `SET search_path`,
- input validation inside the function body,
- and either `REVOKE EXECUTE … FROM PUBLIC` (server-only functions) or an
  in-body `auth.uid()` / role check (functions callable by end users).

---

## Accepted functions

### `public.has_role(_user_id uuid, _role app_role)`
- **Why DEFINER:** every RLS policy in the app calls `has_role(auth.uid(), 'admin')`.
  If it ran as INVOKER, each policy check would require the caller to have
  `SELECT` on `public.user_roles`, defeating the point of the roles table
  and enabling trivial privilege enumeration.
- **Why executable by `authenticated`:** policies evaluate as the caller,
  so the caller must be able to invoke the helper. `anon` executability is
  also acceptable because the function only reads `user_roles` filtered by
  `_user_id` and returns a boolean — no data leakage.
- **Bounded by:** `SET search_path = public`; pure SELECT; no side effects.

### `public.enqueue_email(queue_name text, payload jsonb)`
### `public.read_email_batch(queue_name text, batch_size int, vt int)`
### `public.delete_email(queue_name text, message_id bigint)`
### `public.email_queue_dispatch()`
### `public.email_queue_wake()`
- **Why DEFINER:** these wrap `pgmq.*` (message queue) and `cron.*` calls.
  `pgmq` and `cron` are not exposed via the Data API and are not granted to
  `authenticated`. Making them INVOKER would require granting end users
  direct schema access to `pgmq`/`cron`, which is far worse.
- **Callers:** `notify_send_receipt` trigger, auth webhook, transactional
  email send route, and the `process-email-queue` cron job.
- **Bounded by:** `SET search_path`; queue name validated by callers;
  vault secret lookups inside the function; no user-supplied SQL.

### `public.notify_send_receipt()`  *(AFTER INSERT trigger)*
### `public.notify_admin_activity_audit_alert()`  *(AFTER INSERT trigger)*
- **Why DEFINER:** trigger reads a webhook secret from `vault.decrypted_secrets`
  and calls `net.http_post`. Vault and `net` are not caller-accessible.
- **Bounded by:** exception-swallowing so failures never block the parent
  INSERT; only fires on successful rows; posts opaque row IDs, not payload.

### `public.grant_lifetime_membership(...)`
### `public.grant_all_access_pass_30d(...)`
### `public.grant_all_access_pass_term(...)`
### `public.grant_panty_listing_order(...)`
### `public.grant_purchase_reward_points(...)`
- **Why DEFINER:** invoked from the verified NOWPayments webhook handler
  after signature verification. Writes across `memberships`,
  `panty_orders`, `panty_listings`, `profiles`, `purchase_reward_grants`
  atomically. INVOKER would require the caller to have blanket write
  access to all of these tables.
- **Why NOT executable by end users:** `REVOKE EXECUTE ... FROM PUBLIC, anon,
  authenticated` in the migration. Called only via `supabaseAdmin`
  (service_role) from the webhook.
- **Bounded by:** idempotency key on `external_payment_reference`;
  environment (`sandbox`/`live`) validated; `_user_id` required.

### `public.redeem_reward(_reward_id uuid, _caller uuid DEFAULT NULL)`
### `public.validate_referral_code(_code text, _email text)`
- **Why DEFINER:** cross-table write (`profiles.reward_points`,
  `user_rewards`, `reward_point_reservations`) or cross-table read
  (`profiles` + `auth.users`) that would otherwise require granting
  authenticated users broader table access.
- **Why NOT executable by end users:** EXECUTE revoked from `PUBLIC`,
  `anon`, `authenticated`. Called only via `supabaseAdmin` from
  `rewards-catalog.functions.ts` / `referral-validate.functions.ts` after
  the server has authenticated the caller and passes `_caller` explicitly.
- **Bounded by:** internal `auth_required` / `insufficient_reward_points`
  checks; row-level lock on the profile row during redemption.

### `public.go_live_status()`
### `public.verify_admin_activity_audit_integrity()`
### `public.search_admin_audit_ids(_q text)`
### `public.admin_find_user_ids_by_email(_email_pattern text)`
### `public.update_payment_integrity_schedule(...)`
- **Why DEFINER:** reads across `cron.job`, `pgmq.*`, `auth.users`, or the
  hash-chained audit table — none of which are directly grantable to
  end users.
- **Why safe:** every function starts with an in-body
  `if not has_role(auth.uid(), 'admin') then raise exception ...` gate.
  A non-admin caller gets an exception before any privileged read.
- **Bounded by:** admin gate; `SET search_path`; no dynamic SQL.

### Field-tamper triggers
- `public.rsvps_block_user_field_tamper()`
- `public.profiles_block_user_staff_field_tamper()`
- `public.memberships_block_user_field_tamper()`
- `public.cohost_applications_block_admin_field_tamper()`
- `public.content_items_block_self_moderation()`
- **Why DEFINER:** each trigger calls `has_role(auth.uid(), 'admin')` to
  decide whether to permit a write. That helper is DEFINER (see above);
  the triggers themselves must also be DEFINER to keep the check
  consistent regardless of the caller's own row visibility.
- **Bounded by:** raises `EXCEPTION` on unauthorized field changes;
  covered by `supabase/tests/rsvps_field_tamper.test.sql` and the
  `PRIVILEGE_ESCALATION` regression suite.

### Housekeeping / retention
- `public.purge_expired_health_screenings()`
- `public.purge_expired_admin_activity_audit()`
- `public.purge_account_rows(_user_id uuid)`
- `public.list_accounts_to_purge()`
- `public.run_payment_integrity_checks()`
- `public.revoke_entitlement_by_payment_reference(...)`
- **Why DEFINER:** invoked by `pg_cron` jobs or by admin-authenticated
  server functions. Delete across many tables and from `storage.objects`;
  INVOKER would require granting cron/service DELETE on every table.
- **Bounded by:** callers are cron or admin server code only; EXECUTE
  revoked from `PUBLIC` where not needed.

### Utility triggers
- `public.set_updated_at_timestamp()`
- `public.touch_updated_at()`
- `public.rsvps_assign_entry_code()`
- `public.rsvps_assign_entry_phrase()`
- `public.log_private_room_booking_status()`
- `public.log_site_settings_pricing_change()`
- `public.admin_activity_audit_chain()`
- `public.handle_new_user()`
- **Why DEFINER (where set):** write into audit / status tables that end
  users must not have direct write access to (`admin_activity_audit`,
  `site_settings_pricing_audit`, `private_room_booking_status_events`,
  `referral_reward_grants`).
- **Bounded by:** `SET search_path`; trigger-only, not directly callable.

---

## What is NOT accepted here

If the linter reports any of the following, treat it as a real finding and
fix at the source — do NOT add it to this document:

- A `SECURITY DEFINER` function **without** an explicit `SET search_path`.
- A function callable by `anon` / `authenticated` that mutates data
  without an internal auth check.
- A new grant/redeem/admin RPC that is executable by `authenticated`
  instead of being called via `supabaseAdmin`.

---

## How this is enforced in CI

Two layers keep this document honest:

1. **`security/lint-baseline.json`** — fingerprints of accepted findings.
   Regenerated with `bun run security:baseline:update`. Any new finding
   with a fingerprint not in this file fails CI.
2. **`SUPABASE_LINT_ALLOWLIST` (workflow env) + `APPROVED_ALLOWLIST`
   (script)** — category-level suppressions for the two SECURITY DEFINER
   rules and the field-tamper `PRIVILEGE_ESCALATION` category. Every
   entry has a one-line rationale pointing back to this file.

See `SECURITY_SCAN.md` for the full workflow.

---

## Marking these as "Accepted" in the Supabase advisor UI

The Supabase Dashboard's Security Advisor does not currently support a
per-finding "Accepted" state that survives across scans. In practice
teams handle this in one of two ways:

1. **Dismiss in the dashboard** — open each warning in Advisor → click
   the row → use the **Dismiss** / **Ignore** action if offered for that
   check. Some checks (notably the search-path and DEFINER checks) do
   not expose a dismiss action; those will keep re-appearing on every
   scan regardless of what you do in the UI. That is expected — the
   dashboard advisor is informational, not a source of truth.
2. **Rely on the CI gate as the source of truth** — this repo already
   does. The `CI / Supabase / Gate (required)` check enforces the
   baseline + allowlist described above, so an accepted finding stays
   green in PRs even while the dashboard keeps showing it. Reviewers
   should look at the CI gate, not the dashboard, when deciding whether
   the security posture has regressed.

If you want the dashboard to stop showing a specific accepted warning
and the row has no Dismiss button, there is no supported way to hide
it from Lovable Cloud — the recommended workflow is to leave it visible
and treat this document + the CI gate as the acceptance record.
