#!/usr/bin/env bash
# Runs the full local reproduction of `CI / Supabase / Gate (required)`
# end-to-end. Prints per-step PASS/FAIL, and on failure names the exact
# step and the CI job it corresponds to, then exits non-zero.
#
# Flags:
#   --skip-migrations   Skip step 3 (Supabase / Migrations). Use when you
#                       only touched policy/allowlist config and haven't
#                       edited SQL or regenerated types. Mirrors the
#                       "one-liner" pre-push hook.
#
# See SECURITY_SCAN.md → "Reproducing the Gate Locally" for what each
# step does and which CI job it mirrors.

set -u -o pipefail

SKIP_MIGRATIONS=0
for arg in "$@"; do
  case "$arg" in
    --skip-migrations) SKIP_MIGRATIONS=1 ;;
    -h|--help)
      sed -n '2,14p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown flag: $arg" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$(mktemp -d -t gate-repro.XXXXXX)"
RESULTS=()
FAILED_STEP=""
FAILED_JOB=""
FAILED_LOG=""

run_step() {
  local step_num="$1"
  local step_name="$2"
  local ci_job="$3"
  shift 3
  local log="$LOG_DIR/step-${step_num}.log"

  echo ""
  echo "=========================================================="
  echo "Step ${step_num}: ${step_name}   (mirrors CI: ${ci_job})"
  echo "=========================================================="
  echo "\$ $*"
  if "$@" 2>&1 | tee "$log"; then
    local rc=${PIPESTATUS[0]}
    if [ "$rc" -eq 0 ]; then
      RESULTS+=("PASS  Step ${step_num}: ${step_name}")
      return 0
    fi
  fi
  local rc=${PIPESTATUS[0]:-1}
  RESULTS+=("FAIL  Step ${step_num}: ${step_name}  (exit ${rc})")
  FAILED_STEP="Step ${step_num}: ${step_name}"
  FAILED_JOB="$ci_job"
  FAILED_LOG="$log"
  return "$rc"
}

# --- Step 1: Supabase / Config Validate ------------------------------------
run_step 1 "Config Validate" "Supabase / Config Validate" \
  bun run validate:security-config || {
  print_summary_and_exit() { :; } # defined below
}

# --- Step 2: Supabase / Lint ----------------------------------------------
if [ -z "$FAILED_STEP" ]; then
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
    RESULTS+=("SKIP  Step 2: Lint  (SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set)")
    FAILED_STEP="Step 2: Lint"
    FAILED_JOB="Supabase / Lint"
    FAILED_LOG=""
    echo ""
    echo "Step 2 skipped: export SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_REF" >&2
    echo "(see SECURITY_SCAN.md → Reproducing the Gate Locally → Prerequisites)." >&2
  else
    run_step 2 "Lint" "Supabase / Lint" \
      bun run lint:supabase || true
  fi
fi

# --- Step 3: Supabase / Migrations ----------------------------------------
if [ -z "$FAILED_STEP" ] && [ "$SKIP_MIGRATIONS" -eq 0 ]; then
  if ! command -v supabase >/dev/null 2>&1; then
    RESULTS+=("SKIP  Step 3: Migrations  (supabase CLI not installed)")
    FAILED_STEP="Step 3: Migrations"
    FAILED_JOB="Supabase / Migrations"
  elif ! docker info >/dev/null 2>&1; then
    RESULTS+=("SKIP  Step 3: Migrations  (Docker not running)")
    FAILED_STEP="Step 3: Migrations"
    FAILED_JOB="Supabase / Migrations"
  else
    migrations_step() {
      set -e
      supabase db start
      trap 'supabase stop --no-backup >/dev/null 2>&1 || true' EXIT
      supabase db reset --local
      supabase db test
      supabase gen types typescript --local > /tmp/types-out.ts
      diff -u \
        <(sed -e 's/[[:space:]]*$//' src/integrations/supabase/types.ts) \
        <(sed -e 's/[[:space:]]*$//' /tmp/types-out.ts)
      cp /tmp/types-out.ts src/integrations/supabase/types.ts
      bunx --bun tsgo --noEmit src/integrations/supabase/types.ts
    }
    run_step 3 "Migrations" "Supabase / Migrations" bash -c "$(declare -f migrations_step); migrations_step" || true
  fi
elif [ "$SKIP_MIGRATIONS" -eq 1 ]; then
  RESULTS+=("SKIP  Step 3: Migrations  (--skip-migrations)")
fi

# --- Summary --------------------------------------------------------------
echo ""
echo "=========================================================="
echo "Gate reproduction summary"
echo "=========================================================="
for line in "${RESULTS[@]}"; do
  echo "  $line"
done
echo ""
echo "Logs: $LOG_DIR"
echo ""

if [ -n "$FAILED_STEP" ]; then
  echo "FAILED: $FAILED_STEP"
  echo "        This mirrors CI job: ${FAILED_JOB}"
  echo "        The gate 'CI / Supabase / Gate (required)' would fail on this PR."
  if [ -n "$FAILED_LOG" ]; then
    echo "        Full log: $FAILED_LOG"
  fi
  echo "        See SECURITY_SCAN.md → Troubleshooting → matching section for fixes."
  exit 1
fi

echo "PASSED: all steps green. The gate would pass for this working tree."
exit 0
