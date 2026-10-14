# Database design

PostgreSQL 16 + PostGIS 3.4. Migrations: `database/migrations/0001…0005` (forward-only, checksummed,
see ADR-005). All server timestamps are `timestamptz`. Geometry uses `geography(…, 4326)`; points are
built as `ST_MakePoint(longitude, latitude)` — **longitude first**.

## Entity relationships

```mermaid
erDiagram
  officers ||--o{ app_users : "OFFICER role link"
  officers ||--o{ devices : registers
  officers ||--o{ duty_sessions : assigned
  app_users ||--o{ duty_sessions : authorises
  duty_sessions ||--o{ duty_zone_assignments : has
  geo_zones ||--o{ duty_zone_assignments : in
  devices ||--|| device_chain_heads : "trusted anchor"
  devices ||--o{ sync_batches : sends
  sync_batches ||--o{ device_events : contains
  devices ||--o{ device_events : "signed by"
  device_events ||--o| patrol_logs : "derived"
  device_events ||--o| evidence_objects : "EVIDENCE_CAPTURED"
  devices ||--o{ ingestion_rejections : "quarantined submissions"
  devices ||--o{ ingestion_conflicts : "conflicting duplicates"
  officers ||--o{ checkins : "derived lifecycle"
  officers ||--o{ review_flags : "review prompts"
  app_users ||--o{ refresh_tokens : sessions
  app_users ||--o{ audit_events : actor
```

## Tables

| Table | Kind | Key constraints |
|---|---|---|
| `officers` | identity (pseudonymous `employee_ref`) | unique ref, rank check, `is_demo` |
| `app_users` | dashboard/mobile accounts | unique lower-case e-mail; OFFICER ⇔ `officer_id` set; Argon2id hash |
| `refresh_tokens` | sessions | only SHA-256 of token stored; family id for reuse detection |
| `devices` | registered keys | SPKI public key, unique SHA-256 fingerprint, `PENDING/ACTIVE/REVOKED` with consistency checks |
| `device_chain_heads` | trusted anchor | last verified (sequence, hash) per device |
| `geo_zones` | spatial | `geography(MultiPolygon,4326)`, GiST index, `ST_IsValid` check, version + validity period |
| `duty_sessions`, `duty_zone_assignments` | assignment | planned window ≤ 16 h, authorising supervisor |
| `sync_batches` | idempotency | `batch_id` PK + request SHA-256 + stored response |
| `device_events` | **original observations, append-only** | PK event id, unique `(device_id, sequence)`, unique hash, full signed envelope, triggers block UPDATE/DELETE/TRUNCATE |
| `ingestion_rejections`, `ingestion_conflicts` | quarantine, append-only | submitted content + SHA-256 preserved |
| `patrol_logs` | derived | `geography(Point,4326)` GiST, spatial result, matched zones |
| `evidence_objects` | derived verification state | declared hashes immutable (trigger); `VERIFIED ⇒ computed = declared` check |
| `checkins` | derived check-in lifecycle | status precedence keeps missed + late separately recorded in events |
| `review_flags` | derived prompts | `dedupe_key` unique, `inputs` JSON = evidence that produced the flag |
| `audit_events`, `audit_chain_head` | append-only, hash-linked custody log | gapless sequence, `previous_hash`, `record_hash`, triggers |
| `retention_policies` | governance | retention days per category |
| `schema_migrations` | versioning | version, file name, checksum |

## Original vs derived data
Resolving a flag updates only `review_flags` (and writes an audit record). The `device_events` row —
including the exact signed envelope — is never modified. This is enforced by a trigger and covered by
the test *"requires notes to resolve … and never alters the observation"*.

## Spatial semantics
`evaluateLocation` (apps/api/src/spatial/zones.ts):
- `INSIDE_ASSIGNED_ZONE` — `ST_Covers(zone, point)` for an assigned zone;
- `OUTSIDE_WITHIN_ACCURACY` — outside, but distance ≤ reported horizontal accuracy + 5 m boundary tolerance;
- `OUTSIDE_ASSIGNED_ZONE` — beyond that allowance (raises a LOW review flag, at most one per duty-hour);
- `NO_ASSIGNED_ZONE`, `NO_LOCATION`.
GPS accuracy (a statistical radius reported by the phone) and polygon precision (the demo polygons are
illustrative rectangles, not surveyed boundaries) are both uncertainties; neither turns a point just
outside a polygon into proof of anything. Zones are evaluated at the **observation time**, so delayed
offline observations use the zone version valid at that time.

## Backup and restore
`scripts/backup-restore-check.sh` performs `pg_dump -Fc` → restore into a new empty database → compares
row counts of the key tables → checks that every `storage_ref` exists in the evidence directory →
re-verifies the audit hash chain on the restored copy. The run recorded in
`docs/results/backup-restore-check.txt` passed. Evidence bytes live on disk and must be backed up
separately (Render disk snapshots or file-level copies).
