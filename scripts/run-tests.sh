#!/usr/bin/env bash
# Runs every automated suite that does not need Android hardware and writes a summary report.
# Requires PostgreSQL+PostGIS reachable via TEST_DATABASE_ADMIN_URL (docker compose up -d db).
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${OUT:-$ROOT/out/test-results}"
mkdir -p "$OUT"
cd "$ROOT"
pnpm run build:packages > "$OUT/build-packages.log" 2>&1 || { echo "package build failed"; exit 1; }
status=0
run() { # name dir command...
  local name=$1 dir=$2; shift 2
  echo "== $name"
  (cd "$dir" && "$@") > "$OUT/$name.log" 2>&1
  local rc=$?
  echo "$rc" > "$OUT/$name.exit"
  [ "$rc" = 0 ] || status=1
  tail -n 4 "$OUT/$name.log" | sed 's/^/   /'
}
for p in event-contracts validation verifier; do run "pkg-$p" "packages/$p" npx vitest run --reporter=default --reporter=json --outputFile="$OUT/pkg-$p.json"; done
run api apps/api npx vitest run --reporter=default --reporter=json --outputFile="$OUT/api.json"
run admin apps/admin npx vitest run --reporter=default --reporter=json --outputFile="$OUT/admin.json"
run mobile apps/mobile npx vitest run --reporter=default --reporter=json --outputFile="$OUT/mobile.json"
run lint . npx eslint .
run typecheck-api apps/api npx tsc -p tsconfig.json --noEmit
run typecheck-admin apps/admin npx tsc -p tsconfig.json --noEmit
run typecheck-mobile apps/mobile npx tsc -p tsconfig.json --noEmit
run build-api apps/api pnpm run build
run build-admin apps/admin pnpm run build
if [ -n "${GRADLE_LIB:-}" ] || [ -d /opt/gradle-8.14.3/lib ]; then run kotlin-jvm . bash scripts/run-kotlin-jvm-tests.sh; fi
node scripts/summarize-test-results.mjs "$OUT" > "$OUT/SUMMARY.md"
cat "$OUT/SUMMARY.md"
exit $status
