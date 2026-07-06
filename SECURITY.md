# Security

## Reporting

Report suspected vulnerabilities privately to danielle@princesspink90.com. Please
do not open public GitHub issues for security reports.

## Allowlisted database linter findings

The Supabase database linter runs in CI via `scripts/supabase-security-lint.mjs`
and fails the build on any WARN or ERROR finding that isn't explicitly
allowlisted. The allowlist is enforced in two places: the `SUPABASE_LINT_ALLOWLIST`
env var (what the runner ignores) and `APPROVED_ALLOWLIST` in the script itself
(what CI will accept the runner ignoring). Widening the allowlist requires a PR
that touches `APPROVED_ALLOWLIST`.

Today the only allowlisted rule is:

### `authenticated_security_definer_function_executable` (and `0029_` prefix)

**Why it's allowlisted.** The linter flags every `SECURITY DEFINER` function in
the `public` schema that is executable by the `authenticated` role. Our
`public.has_role(_user_id uuid, _role app_role)` helper is intentionally
`SECURITY DEFINER` — it's the standard pattern for role checks inside RLS
policies, and it needs to be callable by authenticated users so those policies
can invoke it. The function:

- takes a `uuid` and enum as inputs, does a single bounded `SELECT` against
  `public.user_roles`, and returns a boolean;
- has `SET search_path = public` to prevent search-path hijacking;
- does not accept or interpolate free-form SQL, table names, or user text;
- performs no writes and returns no data beyond the boolean result.

The lint is a category flag, not evidence of a concrete vulnerability here.

**When to re-evaluate.** Remove the allowlist entry (and rework the function)
if any of the following change:

- `has_role` is modified to accept additional inputs, especially anything
  used to build identifiers or SQL dynamically;
- `has_role` starts reading tables other than `public.user_roles`, performing
  writes, or returning richer data;
- the `SET search_path = public` guard is removed or its owner changes to a
  role other than the intended definer;
- a second `SECURITY DEFINER` function is added to `public` and executable by
  `authenticated` — that new function must be reviewed on its own merits
  before its lint ID is added to `APPROVED_ALLOWLIST`;
- Supabase updates the lint (e.g. a new numbered variant beyond `0029_`) with
  materially different semantics — treat the new ID as unapproved until
  reviewed.

Re-evaluate opportunistically at least once per major dependency bump of
`@supabase/*` packages or when Supabase publishes new linter rules.
