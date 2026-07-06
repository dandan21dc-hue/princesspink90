#!/usr/bin/env bash
# Point this clone's git at the versioned .githooks/ directory so the
# pre-push gate runs automatically. Idempotent — safe to re-run.
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

CURRENT="$(git config --local --get core.hooksPath || echo "")"
if [ "$CURRENT" = ".githooks" ]; then
  echo "hooks: core.hooksPath already set to .githooks — nothing to do."
else
  git config --local core.hooksPath .githooks
  echo "hooks: set core.hooksPath = .githooks"
fi

# Ensure the tracked hook is executable in this working tree. Git respects
# the file's exec bit; .githooks/pre-push is committed +x, but re-apply in
# case a Windows/WSL checkout dropped it.
chmod +x "$ROOT/.githooks/"* 2>/dev/null || true

echo "hooks: installed. Test with:  git push --dry-run"
echo "  Bypass once:            git push --no-verify"
echo "  Include migrations:     RUN_MIGRATIONS=1 git push"
echo "  Force run on any push:  GATE_HOOK_ALWAYS=1 git push"
