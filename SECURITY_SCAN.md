# Security Scan Gate — How It Works and How to Update It

This repo blocks PRs on Supabase-side security regressions through a single
required status check in branch protection:

> **`CI / Supabase / Gate (required)`**

That gate is a no-op aggregator — it just re-reports the result of the two
upstream jobs that do the real work:

| Job (workflow file) | What it checks |
| --- | --- |
| `CI / Supabase / Lint` | Runs `scripts/supabase-security-lint.mjs` against the live database-linter API. Fails on any new WARN/ERROR finding not in the allowlist or baseline. |
| `CI / Supabase / Migrations` | Spins up an ephemeral Supabase, replays `supabase/migrations/*.sql`, runs `supabase db test` (RLS + field-tamper regression tests), and diffs the regenerated types file against the committed one. |

If either upstream job fails (or is skipped/cancelled), the gate fails and
the PR cannot merge.

---

## The Two Layers That Suppress a Finding

The linter has **two** independent suppression layers. They exist for
different reasons and are updated differently — do not confuse them.

### 1. `security/lint-baseline.json` — fingerprint baseline (preferred)

- One entry per specific finding (`{ fingerprint, name, level, note }`).
- A fingerprint is the linter's `cache_key` when present, otherwise
  `name|LEVEL|schema.table`.
- CI passes when every current WARN/ERROR finding's fingerprint is in this
  file. A brand-new finding fails CI.
- Prunable: stale baseline entries (findings no longer reported) log a
  warning but do NOT fail CI, so you can remove them in a follow-up PR
  without an emergency red build.

**When to use:** the default. Any specific offender you're accepting for
now — a legacy table, a known-safe policy, an intentional exposure — goes
here.

### 2. `SUPABASE_LINT_ALLOWLIST` env + `APPROVED_ALLOWLIST` map — category allowlist

- Set in `.github/workflows/ci.yml` on the `Supabase / Lint` job's env,
  plus optional repo-level `vars.SUPABASE_LINT_ALLOWLIST` merged in.
- Matched against either the finding's `name` OR its `category`
  (case-insensitive). Suppresses **every** finding matching that key.
- Every entry MUST also be present in `APPROVED_ALLOWLIST` inside
  `scripts/supabase-security-lint.mjs`, mapped to a rationale sourced
  from `@security-memory`. If an entry isn't in the approved map, the
  linter refuses to run — this is the guardrail against someone
  quietly widening the allowlist via a repo variable.
- On every suppression, the CI log prints the rationale so reviewers can
  see *why* each finding was permitted.

**When to use:** rare. Only for whole categories that are structurally
accepted (e.g. `PRIVILEGE_ESCALATION` for the documented BEFORE UPDATE
field-tamper triggers, or the `has_role` SECURITY DEFINER executable
rule). If you can name a specific fingerprint, use the baseline instead.

---

## Playbooks

### A. CI is red on your PR because of a new lint finding

1. Read the CI log — the linter prints each blocking finding as:
   ```
   [WARN] rls_disabled_in_public (rls_disabled_in_public|WARN|public.orders) — RLS disabled ...
   ```
2. **Fix it first.** Most findings mean a real gap: missing RLS, missing
   `GRANT`, over-broad policy, exposed sensitive column, `SECURITY DEFINER`
   without `SET search_path`.
3. Only if the finding is intentionally accepted:
   - Update `@security-memory` with the rationale (what the risk is, why
     it's accepted, who signed off).
   - Regenerate the baseline locally:
     ```bash
     SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... \
       node scripts/supabase-security-lint.mjs --update-baseline
     ```
   - Commit **only** the intended `security/lint-baseline.json` diff. Every
     added fingerprint is a security acceptance — reviewers should read the
     diff line by line.
   - Get sign-off from the CODEOWNERS owner for `security/` (see
     `.github/CODEOWNERS`).

### B. CI is red because migrations or `supabase db test` failed

1. Open the failed job and read the "Diagnose failing db test" step — it
   dumps:
   - The full `supabase db test` transcript.
   - A verbose `psql -a -e -f` re-run of each `*.test.sql` (exact failing
     line + SQLSTATE).
   - Last 400 lines of the Postgres server log (contains
     `RAISE EXCEPTION` context from field-tamper triggers).
   - Current `rsvps` policies + trigger + full function body, to detect
     drift from what the test expects.
2. Download the `supabase-db-test-logs` artifact from the run for offline
   inspection.
3. Fix the migration or the test; don't "fix" by weakening the trigger.

### C. Adding a new category-level allowlist entry (rare)

1. Confirm no fingerprint-level entry will do — categories are broad by
   nature and can hide future regressions.
2. Add the entry to `APPROVED_ALLOWLIST` in
   `scripts/supabase-security-lint.mjs` with a one-sentence rationale
   pointing at `@security-memory`.
3. Add the same string to `SUPABASE_LINT_ALLOWLIST` in
   `.github/workflows/ci.yml`.
4. Update `@security-memory` with the full rationale (guarded columns,
   why the risk is accepted, who reviewed).
5. PR review required from the CODEOWNERS owner for
   `scripts/supabase-security-lint.mjs`.

### D. Removing a stale acceptance

1. If the linter reports a baseline entry as "no longer reported (safe to
   prune)", delete it from `security/lint-baseline.json` in a follow-up
   PR. Do not skip this — stale entries hide real regressions if the
   fingerprint ever recurs on a different object.
2. If a category allowlist entry is no longer needed (the underlying
   trigger/policy was removed), delete it from `SUPABASE_LINT_ALLOWLIST`
   in the workflow AND from `APPROVED_ALLOWLIST` in the script, and
   remove the rationale from `@security-memory`.

### E. Adding a new RLS or field-tamper regression test

1. Drop the test file at `supabase/tests/<feature>.test.sql`. Use the
   existing `rsvps_field_tamper.test.sql` as a template — set the JWT
   claim, attempt the mutation, assert `RAISES EXCEPTION`.
2. Push. `CI / Supabase / Migrations` picks it up automatically — no
   workflow change needed.

---

## Where Things Live

| Path | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Defines `Supabase / Lint`, `Supabase / Migrations`, `Supabase / Gate (required)`. |
| `.github/CODEOWNERS` | Requires security review for `security/`, `scripts/supabase-security-lint.mjs`, `supabase/migrations/`, `supabase/tests/`, and workflow files. |
| `scripts/supabase-security-lint.mjs` | The linter runner: fetches findings, applies allowlist + baseline, prints rationales, exits non-zero on new WARN/ERROR. |
| `security/lint-baseline.json` | Fingerprint baseline of accepted findings. Regenerated with `--update-baseline`. |
| `supabase/migrations/*.sql` | Schema, GRANTs, RLS policies, SECURITY DEFINER functions, field-tamper triggers. |
| `supabase/tests/*.test.sql` | pgTAP-style regression tests run by `supabase db test`. |
| `SECURITY.md` | High-level security posture; read alongside `@security-memory`. |
| `@security-memory` | Living rationale document for every accepted finding — the source of truth for `APPROVED_ALLOWLIST` entries. |

---

## Non-Goals

- This gate does NOT run the Lovable `supabase_lov` agent scanner — that
  scanner has no public CLI. Its findings are captured in
  `@security-memory` when you invoke it manually pre-merge.
- This gate does NOT persist ad-hoc `run_security_scan` results into the
  Lovable findings store — that's a platform limitation, not something
  this repo controls.
- Branch protection itself is configured in the GitHub UI, not in this
  repo. See "Where Things Live" above for what to add
  (`CI / Supabase / Gate (required)`).
