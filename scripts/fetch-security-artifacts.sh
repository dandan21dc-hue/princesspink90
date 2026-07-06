#!/usr/bin/env bash
# ------------------------------------------------------------------------
# fetch-security-artifacts.sh
#
# Download the four security artifacts uploaded by CI for a given
# workflow run and open them locally for inspection.
#
# Artifacts fetched (see .github/workflows/ci.yml):
#   - supabase-config-validate-report  (always uploaded)
#   - supabase-security-lint-report    (always uploaded)
#   - supabase-migrations-report       (always uploaded)
#   - supabase-db-test-logs            (failure only)
#
# Usage:
#   scripts/fetch-security-artifacts.sh                # latest run on current branch
#   scripts/fetch-security-artifacts.sh <run-id>       # specific run id
#   scripts/fetch-security-artifacts.sh --pr <number>  # latest run for a PR
#   scripts/fetch-security-artifacts.sh --branch main  # latest run on a branch
#   scripts/fetch-security-artifacts.sh --failed       # latest FAILED run on current branch
#
# Flags:
#   --out <dir>     Destination directory (default: .security-artifacts/<run-id>)
#   --no-open       Skip opening files after download
#   --only <name>   Fetch a single artifact by name
#
# Requires: gh (GitHub CLI, authenticated), jq
# ------------------------------------------------------------------------
set -euo pipefail

RUN_ID=""
PR_NUMBER=""
BRANCH=""
FAILED_ONLY=0
OUT_DIR=""
NO_OPEN=0
ONLY_ARTIFACT=""

usage() {
  sed -n '2,25p' "$0"
  exit "${1:-0}"
}

# --- parse args ---------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --pr)      PR_NUMBER="$2"; shift 2 ;;
    --branch)  BRANCH="$2"; shift 2 ;;
    --failed)  FAILED_ONLY=1; shift ;;
    --out)     OUT_DIR="$2"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    --only)    ONLY_ARTIFACT="$2"; shift 2 ;;
    -h|--help) usage 0 ;;
    -*)        echo "Unknown flag: $1" >&2; usage 1 ;;
    *)         RUN_ID="$1"; shift ;;
  esac
done

# --- preflight ----------------------------------------------------------
for cmd in gh jq; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "❌ '$cmd' is required. Install: https://cli.github.com" >&2
    exit 1
  fi
done

if ! gh auth status >/dev/null 2>&1; then
  echo "❌ gh is not authenticated. Run: gh auth login" >&2
  exit 1
fi

# --- resolve run id -----------------------------------------------------
if [ -z "$RUN_ID" ]; then
  echo "🔎 Resolving workflow run..."
  QUERY_ARGS=(--workflow ci.yml --limit 1 --json databaseId,headBranch,status,conclusion,event,url)

  if [ -n "$PR_NUMBER" ]; then
    # For PRs: find the head branch, then filter runs on that branch.
    BRANCH="$(gh pr view "$PR_NUMBER" --json headRefName -q .headRefName)"
    echo "   PR #$PR_NUMBER → branch: $BRANCH"
  fi

  if [ -z "$BRANCH" ]; then
    BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")"
    if [ -z "$BRANCH" ] || [ "$BRANCH" = "HEAD" ]; then
      echo "❌ Could not determine branch. Pass a run id or use --branch." >&2
      exit 1
    fi
    echo "   Using current branch: $BRANCH"
  fi

  QUERY_ARGS+=(--branch "$BRANCH")
  if [ "$FAILED_ONLY" -eq 1 ]; then
    QUERY_ARGS+=(--status failure)
  fi

  RUN_JSON="$(gh run list "${QUERY_ARGS[@]}")"
  RUN_ID="$(echo "$RUN_JSON" | jq -r '.[0].databaseId // empty')"

  if [ -z "$RUN_ID" ]; then
    echo "❌ No matching workflow run found on branch '$BRANCH'." >&2
    exit 1
  fi

  RUN_URL="$(echo "$RUN_JSON" | jq -r '.[0].url')"
  RUN_STATUS="$(echo "$RUN_JSON" | jq -r '.[0].status')"
  RUN_CONCLUSION="$(echo "$RUN_JSON" | jq -r '.[0].conclusion')"
  echo "   Resolved run: $RUN_ID  ($RUN_STATUS/$RUN_CONCLUSION)"
  echo "   $RUN_URL"
fi

# --- destination --------------------------------------------------------
if [ -z "$OUT_DIR" ]; then
  OUT_DIR=".security-artifacts/$RUN_ID"
fi
mkdir -p "$OUT_DIR"
echo "📁 Downloading to: $OUT_DIR"

# --- artifact list ------------------------------------------------------
ARTIFACTS=(
  supabase-config-validate-report
  supabase-security-lint-report
  supabase-migrations-report
  supabase-db-test-logs
)

if [ -n "$ONLY_ARTIFACT" ]; then
  ARTIFACTS=("$ONLY_ARTIFACT")
fi

# Which artifacts actually exist on this run
AVAILABLE="$(gh run view "$RUN_ID" --json artifacts -q '.artifacts[].name' 2>/dev/null || true)"

DOWNLOADED=()
SKIPPED=()

for name in "${ARTIFACTS[@]}"; do
  if ! echo "$AVAILABLE" | grep -Fxq "$name"; then
    SKIPPED+=("$name (not present on this run)")
    continue
  fi
  echo ""
  echo "⬇️  $name"
  if gh run download "$RUN_ID" --name "$name" --dir "$OUT_DIR/$name" 2>&1; then
    DOWNLOADED+=("$name")
  else
    SKIPPED+=("$name (download failed)")
  fi
done

# --- summary ------------------------------------------------------------
echo ""
echo "===================================================="
echo "Downloaded (${#DOWNLOADED[@]}):"
for a in "${DOWNLOADED[@]}"; do
  echo "  ✅ $OUT_DIR/$a/"
  find "$OUT_DIR/$a" -maxdepth 2 -type f -printf '     • %P (%s bytes)\n' 2>/dev/null || \
    (cd "$OUT_DIR/$a" && ls -la)
done
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo ""
  echo "Skipped (${#SKIPPED[@]}):"
  for a in "${SKIPPED[@]}"; do echo "  ⏭️  $a"; done
fi
echo "===================================================="

# --- open ---------------------------------------------------------------
if [ "$NO_OPEN" -eq 1 ] || [ "${#DOWNLOADED[@]}" -eq 0 ]; then
  exit 0
fi

open_path() {
  local p="$1"
  if command -v open >/dev/null 2>&1; then          # macOS
    open "$p" 2>/dev/null || true
  elif command -v xdg-open >/dev/null 2>&1; then    # Linux
    xdg-open "$p" >/dev/null 2>&1 || true
  elif command -v explorer.exe >/dev/null 2>&1; then # WSL
    explorer.exe "$(wslpath -w "$p")" 2>/dev/null || true
  fi
}

echo ""
echo "📖 Opening artifact folder + printing key logs..."
open_path "$OUT_DIR"

# Print head of every log so failures are immediately visible in the terminal.
for a in "${DOWNLOADED[@]}"; do
  for f in "$OUT_DIR/$a"/*.log "$OUT_DIR/$a"/*.diff; do
    [ -e "$f" ] || continue
    echo ""
    echo "----- $f (first 80 lines) -----"
    head -n 80 "$f" || true
  done
done
