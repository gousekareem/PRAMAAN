#!/usr/bin/env bash
# Disaster-recovery drill: dump the PRAMAAN database, restore it into a CLEAN database and
# verify record counts, evidence references and the audit hash chain.
# Usage: SOURCE_URL=postgres://... ADMIN_URL=postgres://.../postgres EVIDENCE_DIR=./storage/evidence scripts/backup-restore-check.sh
set -euo pipefail
: "${SOURCE_URL:?set SOURCE_URL}"
: "${ADMIN_URL:?set ADMIN_URL (maintenance database URL)}"
RESTORE_DB="${RESTORE_DB:-pramaan_restore_check}"
OUT="${OUT:-./backups}"
mkdir -p "$OUT"
DUMP="$OUT/pramaan-$(date -u +%Y%m%dT%H%M%SZ).dump"
RESULT="${RESULT_FILE:-$OUT/backup-verification.json}"
# Machine-readable result for the dashboard status page (BACKUP_VERIFICATION_FILE). Written on success
# AND on failure, so the page never shows a stale "verified" state for a failed drill.
write_result() {
  printf '{"passed": %s, "checkedAt": "%s", "dump": "%s", "dumpSha256": "%s", "detail": "%s"}\n' \
    "$1" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$DUMP")" "$(cut -d' ' -f1 "$DUMP.sha256" 2>/dev/null || true)" "$2" > "$RESULT"
}
trap 'write_result false "restore drill failed at line $LINENO"' ERR

echo "1/5 pg_dump (custom format) -> $DUMP"
pg_dump --format=custom --no-owner --no-privileges --file "$DUMP" "$SOURCE_URL"
sha256sum "$DUMP" | tee "$DUMP.sha256"

echo "2/5 create clean database $RESTORE_DB"
psql "$ADMIN_URL" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $RESTORE_DB WITH (FORCE)" -c "CREATE DATABASE $RESTORE_DB"
RESTORE_URL="${ADMIN_URL%/*}/$RESTORE_DB"

echo "3/5 pg_restore"
pg_restore --no-owner --no-privileges --exit-on-error --dbname "$RESTORE_URL" "$DUMP"

echo "4/5 compare record counts"
Q="SELECT string_agg(t || '=' || n, ' ' ORDER BY t) FROM (
  SELECT 'device_events' t, count(*) n FROM device_events UNION ALL SELECT 'audit_events', count(*) FROM audit_events
  UNION ALL SELECT 'evidence_objects', count(*) FROM evidence_objects UNION ALL SELECT 'patrol_logs', count(*) FROM patrol_logs
  UNION ALL SELECT 'review_flags', count(*) FROM review_flags UNION ALL SELECT 'ingestion_rejections', count(*) FROM ingestion_rejections
  UNION ALL SELECT 'geo_zones', count(*) FROM geo_zones UNION ALL SELECT 'schema_migrations', count(*) FROM schema_migrations
  UNION ALL SELECT 'officers', count(*) FROM officers UNION ALL SELECT 'app_users', count(*) FROM app_users
  UNION ALL SELECT 'duty_assignments', count(*) FROM duty_assignments UNION ALL SELECT 'duty_assignment_personnel', count(*) FROM duty_assignment_personnel
  UNION ALL SELECT 'duty_assignment_changes', count(*) FROM duty_assignment_changes UNION ALL SELECT 'record_corrections', count(*) FROM record_corrections) x"
SRC=$(psql "$SOURCE_URL" -At -c "$Q"); DST=$(psql "$RESTORE_URL" -At -c "$Q")
echo "  source : $SRC"; echo "  restore: $DST"
[ "$SRC" = "$DST" ] || { echo "COUNT MISMATCH"; write_result false "record count mismatch"; exit 1; }

echo "5/5 evidence references + audit chain on the restored copy"
MISSING=0
while read -r ref; do
  [ -z "$ref" ] && continue
  if [ -n "${EVIDENCE_DIR:-}" ] && [ ! -f "$EVIDENCE_DIR/$ref" ]; then echo "  missing object: $ref"; MISSING=$((MISSING+1)); fi
done < <(psql "$RESTORE_URL" -At -c "SELECT storage_ref FROM evidence_objects WHERE storage_ref IS NOT NULL")
echo "  evidence objects missing from storage: $MISSING (evidence bytes are backed up separately from the database)"
(cd "$(dirname "$0")/../apps/api" && DATABASE_URL="$RESTORE_URL" npx tsx --env-file-if-exists=../../.env src/tools/verify-audit-cli.ts) | tee "$OUT/restore-audit-verification.json" | head -5
[ "$MISSING" = 0 ] || { write_result false "$MISSING evidence object(s) missing"; exit 1; }
trap - ERR
write_result true "counts equal; evidence references present; audit chain verified on restored copy"
echo "RESTORE CHECK PASSED (result: $RESULT)"
