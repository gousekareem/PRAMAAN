# ADR-005 — Forward-only SQL migrations with checksums

**Status:** Accepted

## Decision
A small migration runner (`apps/api/src/database/migrate.ts`) applies `database/migrations/NNNN_*.sql`
in order, each in its own transaction, records a SHA-256 checksum in `schema_migrations`, refuses to
run if an applied file was edited, and uses a PostgreSQL advisory lock against concurrent runners.
Plain SQL was chosen over an ORM migration DSL so that PostGIS types, triggers and partial indexes are
expressed exactly and reviewed as SQL.

## Rollback
Forward-only: a faulty migration is corrected by a new migration. Disaster recovery uses
`pg_dump`/`pg_restore` (see `scripts/backup-restore-check.sh`), which was exercised on a clean database.
