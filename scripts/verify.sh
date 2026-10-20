#!/usr/bin/env bash
# @file verify.sh
# @description Run the QurioDB checks. `fast` is the web typecheck; `full` adds the web and API test suites.
# Usage: bash scripts/verify.sh [fast|full]   (also: bun run typecheck, bun run verify)
# The API tests use apps/api/venv when present; set PYTHON to override the interpreter.
set -euo pipefail

mode="${1:-full}"
cd "$(dirname "$0")/.."

python_bin="${PYTHON:-python}"
if [ -z "${PYTHON:-}" ] && [ -x apps/api/venv/bin/python ]; then
  python_bin="$PWD/apps/api/venv/bin/python"
fi

step() { printf '\n==> %s\n' "$1"; }

case "$mode" in
  fast|full) ;;
  *) echo "Usage: bash scripts/verify.sh [fast|full]" >&2; exit 2 ;;
esac

step "web typecheck"
(cd apps/web && bunx tsc --noEmit)

if [ "$mode" = "full" ]; then
  step "web tests"
  (cd apps/web && bunx vitest run)
  step "api tests"
  (cd apps/api && "$python_bin" -m pytest -q -p no:cacheprovider)
fi

printf '\nverify %s: OK\n' "$mode"
