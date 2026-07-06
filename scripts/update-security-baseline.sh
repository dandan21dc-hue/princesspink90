#!/usr/bin/env bash
#
# Regenerate security/lint-baseline.json from the current Supabase linter
# findings and commit the diff in one step.
#
# Usage:
#   SUPABASE_ACCESS_TOKEN=... SUPABASE_PROJECT_REF=... \
#     bun run security:baseline:update            # regenerate, stage, commit
#   ... security:baseline:update -- --dry-run     # regenerate + diff only
#   ... security:baseline:update -- --no-commit   # regenerate + stage only
#
# Every added fingerprint in the resulting diff is a *security acceptance* —
# CODEOWNERS must review the PR. See SECURITY_SCAN.md (Playbook A) and
# SECURITY.md before running.

set -euo pipefail

DRY_RUN=0
NO_COMMIT=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --no-commit) NO_COMMIT=1 ;;
    -h|--help)
      sed -n '2,15p' "$0"
      exit 0 ;;
    *)
      echo "Unknown flag: $arg" >&2
      exit 2 ;;
  esac
done

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

: "${SUPABASE_ACCESS_TOKEN:?SUPABASE_ACCESS_TOKEN must be set}"
: "${SUPABASE_PROJECT_REF:?SUPABASE_PROJECT_REF must be set}"

baseline="security/lint-baseline.json"

echo "==> Regenerating $baseline from live linter findings..."
node scripts/supabase-security-lint.mjs --update-baseline

echo
echo "==> Diff vs. HEAD:"
if git diff --quiet -- "$baseline"; then
  echo "    (no changes — baseline already up to date)"
  exit 0
fi
git --no-pager diff -- "$baseline"

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo
  echo "==> --dry-run: leaving working tree modified, not staging."
  exit 0
fi

echo
echo "==> Staging $baseline"
git add "$baseline"

if [[ "$NO_COMMIT" -eq 1 ]]; then
  echo "==> --no-commit: staged but not committed. Review, then commit manually."
  exit 0
fi

msg="chore(security): refresh supabase lint baseline"
echo "==> Committing: $msg"
git commit -m "$msg" -m "Regenerated via bun run security:baseline:update. Every added fingerprint is an accepted security finding — reviewer must check @security-memory rationale (see SECURITY_SCAN.md Playbook A)."

echo
echo "Done. Push and open a PR; CODEOWNERS review is required for security/."
