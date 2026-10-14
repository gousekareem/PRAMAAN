# Database

- `migrations/0001_extensions.sql` – PostGIS, helper triggers (`pramaan_append_only`, `pramaan_touch_updated_at`)
- `migrations/0002_identity_and_assets.sql` – officers, users, refresh tokens, devices, chain heads, zones, duties
- `migrations/0003_ingestion.sql` – sync batches, append-only device events, rejections, conflicts
- `migrations/0004_domain.sql` – patrol logs, evidence objects, check-ins, review flags, retention policies
- `migrations/0005_audit.sql` – hash-linked audit log + TRUNCATE guards
- `seeds/0001_demo_zones.sql` – fictional, illustrative zones (applied by `pnpm db:seed`)
- `schema.sql` – `pg_dump --schema-only` snapshot after all migrations (reference only; migrations are authoritative)
- `roles.sql` – optional least-privilege roles for self-managed PostgreSQL

Apply: `pnpm db:migrate`. Demo data: `pnpm db:seed` (refused in production). Reset: `pnpm db:seed -- --reset`.

**Coordinate order:** PostGIS points are `ST_MakePoint(longitude, latitude)`; geometry is `geography(…, 4326)`
so `ST_Distance`/`ST_DWithin` return metres.

**Rollback:** forward-only. Fix with a new migration; restore from `pg_dump` for data damage
(`scripts/backup-restore-check.sh`).
