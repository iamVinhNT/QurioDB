#!/usr/bin/env bash
# @file verify.sh
# @description Run the QurioDB checks. `fast` is the web typecheck (what the Stop hook runs); `changed` runs only the
# tests related to uncommitted changes; `full` adds the whole web and API test suites.
# Usage: bash scripts/verify.sh [fast|changed|full]   (also: bun run typecheck, bun run test:changed, bun run verify)
# `changed` time depends on how central the changed files are: a leaf module takes seconds, a shared one can pull in much of a suite.
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
  fast|changed|full) ;;
  *) echo "Usage: bash scripts/verify.sh [fast|changed|full]" >&2; exit 2 ;;
esac

if [ "$mode" = "changed" ]; then
  web=(); api_tests=(); api_stems=()
  while IFS= read -r file; do
    [ -f "$file" ] || continue
    case "$file" in
      apps/web/*.ts|apps/web/*.tsx|apps/web/*.js|apps/web/*.jsx) web+=("${file#apps/web/}") ;;
      apps/api/tests/*.py) api_tests+=("tests/${file#apps/api/tests/}") ;;
      apps/api/*.py) stem="$(basename "$file" .py)"; [ "$stem" != "__init__" ] && api_stems+=("$stem") ;;
    esac
  done < <({ git diff --name-only HEAD; git ls-files -o --exclude-standard; } | sort -u)

  if [ ${#web[@]} -gt 0 ]; then
    step "web: vitest related (${#web[@]} changed files)"
    (cd apps/web && bunx vitest related --run --passWithNoTests "${web[@]}")
  fi

  if [ ${#api_stems[@]} -gt 0 ] || [ ${#api_tests[@]} -gt 0 ]; then
    for stem in ${api_stems[@]+"${api_stems[@]}"}; do
      while IFS= read -r hit; do api_tests+=("tests/${hit#apps/api/tests/}"); done \
        < <(grep -rlw --include='test_*.py' -- "$stem" apps/api/tests 2>/dev/null || true)
    done
    mapfile -t api_tests < <(printf '%s\n' ${api_tests[@]+"${api_tests[@]}"} | sort -u)
    if [ ${#api_tests[@]} -eq 0 ]; then
      step "api: no test mentions the changed modules, running the whole API suite"
      (cd apps/api && "$python_bin" -m pytest -q -p no:cacheprovider)
    else
      step "api: pytest on ${#api_tests[@]} related test files"
      (cd apps/api && "$python_bin" -m pytest -q -p no:cacheprovider "${api_tests[@]}")
    fi
  fi

  if [ ${#web[@]} -eq 0 ] && [ ${#api_stems[@]} -eq 0 ] && [ ${#api_tests[@]} -eq 0 ]; then
    echo "changed: no changed web or API source files, nothing to run"
  fi
  printf '\nverify changed: OK\n'
  exit 0
fi

step "web typecheck"
(cd apps/web && bunx tsc --noEmit)

if [ "$mode" = "full" ]; then
  step "web tests"
  (cd apps/web && bunx vitest run)
  step "api tests"
  (cd apps/api && "$python_bin" -m pytest -q -p no:cacheprovider)
fi

printf '\nverify %s: OK\n' "$mode"
