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
#   --json-out <path>   Write structured JSON summary to <path> in addition
#                       to <log-dir>/results.json. Machine-readable output
#                       includes per-step status, timings, exit codes, the
#                       command line, and (on failure) the failing command.
#
# See SECURITY_SCAN.md → "Reproducing the Gate Locally" for what each
# step does and which CI job it mirrors.

set -u -o pipefail

SKIP_MIGRATIONS=0
JSON_OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-migrations) SKIP_MIGRATIONS=1 ; shift ;;
    --json-out) JSON_OUT="${2:-}" ; shift 2 ;;
    --json-out=*) JSON_OUT="${1#*=}" ; shift ;;
    -h|--help)
      sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$(mktemp -d -t gate-repro.XXXXXX)"
JSON_FILE="$LOG_DIR/results.json"
RESULTS=()
STEPS_JSON=()
FAILED_STEP=""
FAILED_JOB=""
FAILED_LOG=""
FAILED_CMD=""
FAILED_RC=""
RUN_STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
RUN_STARTED_EPOCH_MS="$(date +%s000)"

# Minimal JSON string escaper (backslash, quote, control chars).
json_escape() {
  local s="$1"
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\r'/\\r}"
  s="${s//$'\t'/\\t}"
  printf '%s' "$s"
}

epoch_ms() {
  # macOS date doesn't do %N; use python if available, else seconds*1000.
  if date +%s%3N 2>/dev/null | grep -qv N; then
    date +%s%3N
  else
    echo "$(($(date +%s) * 1000))"
  fi
}

append_step_json() {
  # $1 num, $2 name, $3 ci_job, $4 status, $5 exit_code, $6 started_ms,
  # $7 ended_ms, $8 duration_ms, $9 command, $10 log_path, $11 skip_reason
  local num="$1" name="$2" ci_job="$3" status="$4" rc="$5"
  local s_ms="$6" e_ms="$7" d_ms="$8" cmd="$9" log="${10}" reason="${11:-}"
  local entry
  entry=$(cat <<EOF
    {
      "step": $num,
      "name": "$(json_escape "$name")",
      "ci_job": "$(json_escape "$ci_job")",
      "status": "$(json_escape "$status")",
      "exit_code": ${rc:-null},
      "started_at_ms": ${s_ms:-null},
      "ended_at_ms": ${e_ms:-null},
      "duration_ms": ${d_ms:-null},
      "command": "$(json_escape "$cmd")",
      "log_path": "$(json_escape "$log")",
      "skip_reason": $( [ -n "$reason" ] && printf '"%s"' "$(json_escape "$reason")" || printf 'null')
    }
EOF
)
  STEPS_JSON+=("$entry")
}

write_json_summary() {
  local overall="$1"
  local run_ended_ms
  run_ended_ms="$(epoch_ms)"
  local run_ended_at
  run_ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  local total_ms=$((run_ended_ms - RUN_STARTED_EPOCH_MS))

  local steps_joined=""
  local first=1
  for s in "${STEPS_JSON[@]}"; do
    if [ $first -eq 1 ]; then steps_joined="$s"; first=0
    else steps_joined="$steps_joined,
$s"
    fi
  done

  local failure_block="null"
  if [ -n "$FAILED_STEP" ]; then
    failure_block=$(cat <<EOF
{
    "step": "$(json_escape "$FAILED_STEP")",
    "ci_job": "$(json_escape "$FAILED_JOB")",
    "exit_code": ${FAILED_RC:-null},
    "command": "$(json_escape "$FAILED_CMD")",
    "log_path": "$(json_escape "$FAILED_LOG")"
  }
EOF
)
  fi

  cat > "$JSON_FILE" <<EOF
{
  "schema_version": 1,
  "tool": "reproduce-security-gate",
  "overall_status": "$(json_escape "$overall")",
  "started_at": "$RUN_STARTED_AT",
  "ended_at": "$run_ended_at",
  "duration_ms": $total_ms,
  "log_dir": "$(json_escape "$LOG_DIR")",
  "skip_migrations": $( [ "$SKIP_MIGRATIONS" -eq 1 ] && echo true || echo false ),
  "failure": $failure_block,
  "steps": [
$steps_joined
  ]
}
EOF

  if [ -n "$JSON_OUT" ]; then
    mkdir -p "$(dirname "$JSON_OUT")" 2>/dev/null || true
    cp "$JSON_FILE" "$JSON_OUT"
  fi
}

run_step() {
  local step_num="$1"
  local step_name="$2"
  local ci_job="$3"
  shift 3
  local log="$LOG_DIR/step-${step_num}.log"
  local cmd_str="$*"

  echo ""
  echo "=========================================================="
  echo "Step ${step_num}: ${step_name}   (mirrors CI: ${ci_job})"
  echo "=========================================================="
  echo "\$ $cmd_str"

  local started_ms ended_ms rc
  started_ms="$(epoch_ms)"
  set +e
  "$@" 2>&1 | tee "$log"
  rc=${PIPESTATUS[0]}
  set -e
  ended_ms="$(epoch_ms)"
  local dur=$((ended_ms - started_ms))

  if [ "$rc" -eq 0 ]; then
    RESULTS+=("PASS  Step ${step_num}: ${step_name}")
    append_step_json "$step_num" "$step_name" "$ci_job" "pass" "$rc" \
      "$started_ms" "$ended_ms" "$dur" "$cmd_str" "$log" ""
    return 0
  fi

  RESULTS+=("FAIL  Step ${step_num}: ${step_name}  (exit ${rc})")
  append_step_json "$step_num" "$step_name" "$ci_job" "fail" "$rc" \
    "$started_ms" "$ended_ms" "$dur" "$cmd_str" "$log" ""
  FAILED_STEP="Step ${step_num}: ${step_name}"
  FAILED_JOB="$ci_job"
  FAILED_LOG="$log"
  FAILED_CMD="$cmd_str"
  FAILED_RC="$rc"
  return "$rc"
}

record_skip() {
  # $1 num, $2 name, $3 ci_job, $4 reason, $5 fatal(0|1)
  local num="$1" name="$2" ci_job="$3" reason="$4" fatal="$5"
  RESULTS+=("SKIP  Step ${num}: ${name}  (${reason})")
  append_step_json "$num" "$name" "$ci_job" "skip" "" "" "" "" "" "" "$reason"
  if [ "$fatal" -eq 1 ]; then
    FAILED_STEP="Step ${num}: ${name}"
    FAILED_JOB="$ci_job"
    FAILED_LOG=""
    FAILED_CMD=""
    FAILED_RC=""
  fi
}

# --- Step 1: Supabase / Config Validate ------------------------------------
run_step 1 "Config Validate" "Supabase / Config Validate" \
  bun run validate:security-config || true

# --- Step 2: Supabase / Lint ----------------------------------------------
if [ -z "$FAILED_STEP" ]; then
  if [ -z "${SUPABASE_ACCESS_TOKEN:-}" ] || [ -z "${SUPABASE_PROJECT_REF:-}" ]; then
    record_skip 2 "Lint" "Supabase / Lint" \
      "SUPABASE_ACCESS_TOKEN / SUPABASE_PROJECT_REF not set" 1
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
    record_skip 3 "Migrations" "Supabase / Migrations" "supabase CLI not installed" 1
  elif ! docker info >/dev/null 2>&1; then
    record_skip 3 "Migrations" "Supabase / Migrations" "Docker not running" 1
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
  record_skip 3 "Migrations" "Supabase / Migrations" "--skip-migrations" 0
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

if [ -n "$FAILED_STEP" ]; then
  write_json_summary "fail"
  echo "JSON: $JSON_FILE${JSON_OUT:+ (also copied to $JSON_OUT)}"
  echo ""
  echo "FAILED: $FAILED_STEP"
  echo "        This mirrors CI job: ${FAILED_JOB}"
  echo "        The gate 'CI / Supabase / Gate (required)' would fail on this PR."
  if [ -n "$FAILED_CMD" ]; then
    echo "        Failing command: $FAILED_CMD"
  fi
  if [ -n "$FAILED_LOG" ]; then
    echo "        Full log: $FAILED_LOG"
  fi
  echo "        See SECURITY_SCAN.md → Troubleshooting → matching section for fixes."
  exit 1
fi

write_json_summary "pass"
echo "JSON: $JSON_FILE${JSON_OUT:+ (also copied to $JSON_OUT)}"
echo ""
echo "PASSED: all steps green. The gate would pass for this working tree."
exit 0
