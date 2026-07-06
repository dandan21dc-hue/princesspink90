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
   - Regenerate the baseline, stage it, and commit it with one command:
     ```bash
     SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... \
       bun run security:baseline:update
     ```
     Flags: `-- --dry-run` to preview the diff without staging;
     `-- --no-commit` to stage without committing. Under the hood this
     runs `scripts/update-security-baseline.sh`, which calls
     `node scripts/supabase-security-lint.mjs --update-baseline`, prints
     the diff of `security/lint-baseline.json`, then `git add` + `git commit`s
     with a `chore(security): refresh supabase lint baseline` message.
   - Every added fingerprint in the resulting diff is a security
     acceptance — reviewers should read the diff line by line.
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

## Reproducing the Gate Locally

Run these in order. Passing all three means CI's `Supabase / Gate
(required)` will pass for the same working tree — nothing in the gate
runs anything you can't run here.

### Prerequisites (once)

```bash
bun install --frozen-lockfile
# Supabase CLI (for the migrations job). macOS:
brew install supabase/tap/supabase
# Docker Desktop / OrbStack running — `supabase db start` needs it.
docker info >/dev/null
```

Export the same two secrets the CI linter job uses. `SUPABASE_PROJECT_REF`
is the project ref; `SUPABASE_ACCESS_TOKEN` is a personal access token
(GitHub → repo secret `SUPABASE_ACCESS_TOKEN`, or generate your own):

```bash
export SUPABASE_ACCESS_TOKEN=sbp_...
export SUPABASE_PROJECT_REF=<ref>
# Mirror the CI env var exactly — same three approved keys.
export SUPABASE_LINT_ALLOWLIST="authenticated_security_definer_function_executable,0029_authenticated_security_definer_function_executable,PRIVILEGE_ESCALATION"
```

### 1. `Supabase / Config Validate` — no network, no secrets

```bash
bun run validate:security-config
```

Exit 0 = baseline JSON schema is valid, `APPROVED_ALLOWLIST` parses, and
every `SUPABASE_LINT_ALLOWLIST` entry is approved. Any failure prints a
specific fix-it line — resolve before running the linter.

### 2. `Supabase / Lint` — hits the live linter API

```bash
bun run lint:supabase
```

Exit 0 = no new WARN/ERROR fingerprint outside `security/lint-baseline.json`
and every suppression printed its rationale. On failure the output lists
each blocking finding; follow **Playbook A** above.

### 3. `Supabase / Migrations` — ephemeral DB + RLS tests + types diff

```bash
# Boot a fresh local Supabase stack, replay every migration, run tests.
supabase db start
supabase db reset --local          # replays supabase/migrations/*.sql
supabase db test                    # runs supabase/tests/*.test.sql

# Regenerate types from the freshly migrated schema and diff.
supabase gen types typescript --local > /tmp/types-out.ts
diff -u \
  <(sed -e 's/[[:space:]]*$//' src/integrations/supabase/types.ts) \
  <(sed -e 's/[[:space:]]*$//' /tmp/types-out.ts)

# Typecheck the regenerated file in isolation, same as CI.
cp /tmp/types-out.ts src/integrations/supabase/types.ts
bunx --bun tsgo --noEmit src/integrations/supabase/types.ts

# Always tear down.
supabase stop --no-backup
```

Any non-zero exit or non-empty diff = the migrations job would fail in
CI. If a `*.test.sql` fails, re-run it verbosely for the exact SQLSTATE
and line — same command CI uses in the diagnose step:

```bash
DB_URL="$(supabase status -o env | awk -F= '/^DB_URL=/{gsub(/"/,"",$2); print $2}')"
psql "$DB_URL" -v ON_ERROR_STOP=1 -a -e -f supabase/tests/<file>.test.sql
```

### 4. Gate parity check

The gate itself has no local equivalent — it's a GitHub Actions
aggregator. But the invariant it enforces is simple: **all three upstream
jobs must exit 0.** If steps 1–3 above pass on your branch, the gate
will pass.

### One-liner: run 1 + 2 together

```bash
bun run validate:security-config && bun run lint:supabase
```

Use this as a pre-push hook when you're only touching migration/policy
files (skip step 3 unless you edited SQL or committed types).

---



## Where Things Live

| Path | Purpose |
| --- | --- |
| `.github/workflows/ci.yml` | Defines `Supabase / Config Validate`, `Supabase / Lint`, `Supabase / Migrations`, `Supabase / Gate (required)`. |
| `.github/CODEOWNERS` | Requires security review for `security/`, `scripts/supabase-security-lint.mjs`, `supabase/migrations/`, `supabase/tests/`, and workflow files. |
| `scripts/supabase-security-lint.mjs` | The linter runner: fetches findings, applies allowlist + baseline, prints rationales, exits non-zero on new WARN/ERROR. |
| `scripts/validate-security-config.mjs` | No-network pre-flight for the gate. Validates baseline JSON schema (fields, level, uniqueness, sort order), parses `APPROVED_ALLOWLIST`, and rejects any `SUPABASE_LINT_ALLOWLIST` entry not in it. Run locally via `bun run validate:security-config`. |
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
