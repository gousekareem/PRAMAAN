#!/usr/bin/env bash
# Linux/macOS equivalent of package-project.ps1: ZIP with a single pramaan/ root, no dependencies, builds or secrets.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="$(realpath -m "${1:-$ROOT/../PRAMAAN_COMPLETE_PROJECT.zip}")"
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/pramaan"
tar -C "$ROOT" \
  --exclude=node_modules --exclude=dist --exclude='./out' --exclude='*/build' --exclude=coverage --exclude='./storage' --exclude='./apps/api/storage' --exclude='./backups' --exclude='./apps/api/backups' \
  --exclude=.gradle --exclude=.cxx --exclude=.env --exclude='*.log' --exclude='*.dump' --exclude=keystore.properties --exclude='*.jks' \
  --exclude='*.tsbuildinfo' -cf - . | tar -C "$STAGE/pramaan" -xf -
# Guard: essential sources must be present (a broad exclude once dropped apps/mobile/src/storage).
for f in apps/mobile/src/storage/db.ts apps/api/src/server.ts apps/admin/src/components/layout/AppFooter.tsx packages/event-contracts/src/index.ts; do
  [ -f "$STAGE/pramaan/$f" ] || { echo "Missing essential file: $f" >&2; exit 1; }
done
( cd "$STAGE/pramaan" && find . -type f ! -name MANIFEST.sha256 -print0 | sort -z | xargs -0 sha256sum > MANIFEST.sha256 )
rm -f "$OUTPUT"
( cd "$STAGE" && zip -qr -X "$OUTPUT" pramaan )
rm -rf "$STAGE"
sha256sum "$OUTPUT"
