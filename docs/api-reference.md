# API reference (v1)

Base URL: `http://localhost:4000` (development) or the Render service URL. JSON unless stated.
Every response carries `X-Request-Id` (a valid client-supplied one is echoed for correlation).

## Error format

```json
{ "error": { "code": "EVIDENCE_HASH_MISMATCH", "message": "…", "requestId": "3b1d…", "details": [] } }
```

| HTTP | Codes |
|---|---|
| 400 | `VALIDATION_FAILED`, `NOT_ELIGIBLE`, `INACTIVE_PERSONNEL` |
| 401 | `AUTHENTICATION_REQUIRED`, `INVALID_CREDENTIALS`, `TOKEN_EXPIRED`, `TOKEN_INVALID` |
| 403 | `FORBIDDEN`, `SELF_MODIFICATION_FORBIDDEN`, `DEVICE_NOT_REGISTERED`, `DEVICE_NOT_APPROVED`, `DEVICE_REVOKED` |
| 404 | `NOT_FOUND`, `EVIDENCE_EVENT_NOT_FOUND` |
| 409 | `CONFLICT`, `IDEMPOTENCY_KEY_REUSED`, `ASSIGNMENT_CONFLICT` (details.conflicts), `INVALID_TRANSITION` |
| 413 | `PAYLOAD_TOO_LARGE`, `EVIDENCE_TOO_LARGE` |
| 422 | `UNSUPPORTED_SCHEMA_VERSION`, `EVIDENCE_HASH_MISMATCH` |
| 423 | `ACCOUNT_LOCKED` |
| 429 | `RATE_LIMITED`, `EVIDENCE_UPLOAD_LIMIT` |
| 500 | `INTERNAL_ERROR`, `STORED_EVIDENCE_INTEGRITY_FAILURE` |
| 503 | `DATABASE_UNAVAILABLE` (with `Retry-After`) |

Stack traces, SQL and secrets are never returned.

## Authorisation in PRAMAAN 2.0
The “Roles” column of the PRAMAAN 1.0 table below describes the **default** behaviour. Since 2.0 every route
checks **permissions** loaded from the database (`requirePermission`), and every query is limited to the caller's
**data scope** (SELF / UNIT / UNIT_TREE / ALL). Out-of-scope records return 404. Mapping:
officers → `personnel.view`; duty sessions → `duty.view` / `duty.create` / `duty.close`; patrol logs and
check-ins → `checkin.view`; evidence → `evidence.view`, `evidence.view_image`, `evidence.export`,
`evidence.package`; dashboard → `dashboard.view`, `map.view`, `exception.view`; alert actions →
`exception.manage`; audit → `audit.view`, `audit.verify`; devices → `device.view`, `device.approve`; device
registration and sync → `checkin.perform`. Client type at login: web needs `web.login`, mobile needs
`mobile.login`. See [`authorization.md`](authorization.md).

## Endpoints

| Method & path | Roles | Purpose |
|---|---|---|
| `GET /health` | public | Liveness (no DB access) |
| `GET /ready` | public | DB, PostGIS version, migration count, storage writable |
| `GET /api/v1/time` | public | Server time (anchor) |
| `POST /api/v1/auth/login` | public (rate-limited) | `{email, password, client: web\|mobile, deviceId?}` |
| `POST /api/v1/auth/refresh` | refresh token | Rotation; web cookie requires `X-PRAMAAN-CSRF: 1` |
| `POST /api/v1/auth/logout` | any | Revokes the session family |
| `GET /api/v1/auth/me` | any | Current user |
| `GET /api/v1/officers` · `/:id` | ADMIN, SUPERVISOR, REVIEWER (`/:id` also own OFFICER) | Officers, current duty, devices, check-ins, evidence, flags |
| `POST /api/v1/devices/register` | OFFICER | Register public key (`PENDING`) |
| `GET /api/v1/devices/mine` | OFFICER | Own devices |
| `GET /api/v1/devices` | ADMIN, SUPERVISOR, REVIEWER | All devices with chain heads |
| `POST /api/v1/devices/:id/approve` · `/revoke` | ADMIN | Lifecycle (revoke also ends the device's sessions) |
| `GET /api/v1/duties` · `/:id` | all (OFFICER: own) | Duty sessions |
| `POST /api/v1/duties` · `/:id/cancel` | ADMIN, SUPERVISOR | Authorise / cancel (no overlaps, ≤ 16 h) |
| `GET /api/v1/zones` | all | GeoJSON FeatureCollection |
| `GET /api/v1/patrol-logs` · `/:id` | all (OFFICER: own) | Derived observations, filters + pagination |
| `GET /api/v1/patrol-logs/export.csv` | ADMIN, SUPERVISOR | CSV (formula-injection safe), audited |
| `POST /api/v1/sync/batch` | OFFICER | Batch ingestion (below) |
| `PUT /api/v1/sync/evidence/:evidenceId` | OFFICER | Multipart `file` upload, server-side SHA-256 verification |
| `GET /api/v1/evidence` | ADMIN, SUPERVISOR, REVIEWER | Search: status, officer, SHA-256 prefix, time |
| `GET /api/v1/evidence/:id` | all (OFFICER: own) | Metadata, hashes, times, ledger neighbours, custody (audited) |
| `GET /api/v1/evidence/:id/content` | ADMIN, SUPERVISOR | JPEG bytes, re-verified on read (audited) |
| `GET /api/v1/evidence/:id/manifest.json` | ADMIN, SUPERVISOR, REVIEWER | Manifest export (audited) |
| `GET /api/v1/evidence/:id/package` | ADMIN, SUPERVISOR | Verification package ZIP (`X-Package-SHA256`, audited) |
| `GET /api/v1/evidence/:id/report.pdf` | ADMIN, SUPERVISOR, REVIEWER | Evidence report PDF (audited) |
| `GET /api/v1/dashboard/summary` · `/observations` · `/alerts` | ADMIN, SUPERVISOR, REVIEWER | Overview, last-known observations with freshness labels, review flags |
| `GET /api/v1/dashboard/stream` | ADMIN, SUPERVISOR, REVIEWER | Server-Sent Events (`batch-ingested`, `flag-created`, `flag-updated`, `evidence-verified`) |
| `PATCH /api/v1/alerts/:id` | ADMIN, SUPERVISOR | `ACKNOWLEDGE \| ASSIGN \| RESOLVE \| DISMISS \| REOPEN` (note required to resolve/dismiss) |
| `GET /api/v1/audit-events` · `/checkpoint` | ADMIN, SUPERVISOR | Audit records, current chain head |
| `GET /api/v1/audit-events/verify` | ADMIN | Full chain verification (audited) |
| `GET /api/v1/users/reviewers` | ADMIN, SUPERVISOR | Assignable reviewers |

Pagination: `?page=1&pageSize=25` (max 100) → `{ items, page, pageSize, total, totalPages }`.

## Sync batch contract {#sync}

Request:
```json
{ "batchId": "uuid (idempotency key)", "schemaVersion": 1, "deviceId": "uuid",
  "events": [ { "schemaVersion": 1, "eventId": "uuid", "eventType": "LOCATION_OBSERVED", "officerId": "uuid",
    "dutySessionId": "uuid|null", "deviceId": "uuid", "deviceSequenceNumber": 42,
    "deviceWallTime": "2026-10-01T08:00:00.000Z", "monotonicElapsedMs": 123456, "bootId": "bc-17",
    "trustedTimeEstimate": "…|null", "trustedTimeUncertaintyMs": 3130, "trustedTimeSource": "SERVER_ANCHOR_MONOTONIC",
    "payload": { }, "previousEventHash": "64 hex", "eventHash": "64 hex", "deviceSignature": "base64 DER" } ] }
```
Limits: 1–200 events, JSON body ≤ 2 MiB. Response `200`:
```json
{ "batchId": "…", "replayed": false, "serverReceivedAt": "…", "serverTime": "…",
  "counts": { "accepted": 48, "duplicate": 1, "rejected": 1, "conflict": 0 },
  "chainHead": { "sequence": 50, "eventHash": "…" },
  "results": [ { "eventId": "…", "sequence": 42, "status": "ACCEPTED", "chainLinkStatus": "LINKED", "retryable": false },
               { "eventId": "…", "sequence": 43, "status": "REJECTED", "code": "INVALID_SIGNATURE", "detail": "…", "retryable": false } ] }
```

**Partial acceptance semantics.** Batch-level problems (auth, unknown/revoked device, schema version,
malformed batch) reject the whole request with no side effects. Otherwise every event is evaluated in its
own savepoint and receives one status; accepted rows, quarantined rejections and conflicts are committed
**together** with the stored batch response. An unexpected server error rolls back the *entire* batch
(nothing acknowledged) and the device retries the same `batchId`. Rejection codes: `INVALID_EVENT`,
`UNSUPPORTED_SCHEMA_VERSION`, `DEVICE_MISMATCH`, `OFFICER_MISMATCH`, `EVENT_HASH_MISMATCH`,
`INVALID_SIGNATURE`, `INVALID_PAYLOAD`, `INVALID_MANIFEST`, `CHAIN_LINK_MISMATCH`,
`DUTY_SESSION_INVALID`, `DUTY_SESSION_EXPIRED`, `DUPLICATE_IN_BATCH`; conflicts:
`CONFLICTING_DUPLICATE`, `SEQUENCE_CONFLICT`.

## Event types
`DUTY_SESSION_STARTED/ENDED`, `CHECKIN_SCHEDULED/PRESENTED/ACKNOWLEDGED/ACKNOWLEDGED_LATE/MISSED`,
`BIOMETRIC_SUCCESS/FAILURE`, `COGNITIVE_CHALLENGE_SUCCESS/FAILURE`, `EVIDENCE_CAPTURED`,
`LOCATION_OBSERVED`, `STEP_MILESTONE`, `MOTION_STATE_CHANGED`, `TRANSIT_STATE_SUSPECTED`,
`SENSOR_UNAVAILABLE`, `SENSOR_PERMISSION_REVOKED`, `LOCATION_MOCK_INDICATOR`, `CLOCK_ANOMALY_DETECTED`,
`MOVEMENT_EVIDENCE_INCONSISTENCY`, `DEVICE_INTEGRITY_OBSERVED`, `SERVICE_LIFECYCLE`.
Payload schemas: `packages/validation/src/index.ts` (strict — unknown fields are rejected).

## Evidence package format
`PRAMAAN-EVIDENCE-PACKAGE-1` ZIP: `package-index.json` (SHA-256 of every file), `evidence/original.jpg`,
`evidence/manifest.json`, `ledger/events.json` (signed, hash-linked events of the duty session),
`device/public-key.json`, `server/verification.json`, `custody/audit-events.json`.
Verify offline: `node packages/verifier/dist/cli.js package.zip [--json]` → exit 0 PASS, 1 FAIL, 2 INCOMPLETE.


## PRAMAAN 2.0 — railway-police operations endpoints

| Method & path | Permission (and scope) | Purpose |
|---|---|---|
| `GET /api/v1/auth/me` | any | User, role label, permissions, scope level, personnel summary |
| `GET /api/v1/auth/sessions` · `POST /api/v1/auth/sessions/:familyId/revoke` | any (own sessions only) | Session management |
| `POST /api/v1/auth/change-password` | any | Self-service password change (other sessions revoked) |
| `GET /api/v1/duty-assignments` | `duty.view` (scoped) | Filters: `category, status (incl. OPEN), unitId, officerId, from, to, q, page` |
| `GET /api/v1/duty-assignments/:id` | `duty.view` (scoped; restricted details redacted) | Detail, personnel history, instructions, handovers, change history, exceptions, evidence, warnings, allowed actions |
| `POST /api/v1/duty-assignments` | `duty.create` (+`duty.assign` with personnel, +`duty.approve` to publish; unit in scope) | Create (optionally with personnel and `publish:true`; `allowConflict` + `overrideReason`) |
| `PATCH /api/v1/duty-assignments/:id` | `duty.assign` | Details/schedule change (reason required once published) |
| `GET /api/v1/duty-assignments/:id/conflicts?officerId=` | `duty.assign` | Conflict preview |
| `POST /api/v1/duty-assignments/:id/personnel` | `duty.assign` (override needs `duty.approve`) | Add personnel |
| `POST …/:id/personnel/:pid/remove` · `…/replace` | `duty.assign` | Remove / replace with reason (history kept) |
| `POST /api/v1/duty-assignments/:id/status` | `duty.approve` (ASSIGNED), `duty.close` (IN_PROGRESS, COMPLETED, CANCELLED), `duty.close` or assigned person (EXCEPTION_REPORTED) | State transition |
| `POST /api/v1/duty-assignments/:id/accept` | assigned person | Accept assignment |
| `POST /api/v1/duty-assignments/:id/instructions` | `duty.instructions.publish` | Publish a new instruction version |
| `POST /api/v1/duty-assignments/instructions/:iid/acknowledge` | assigned person | Acknowledge a version |
| `POST /api/v1/duty-assignments/:id/handovers` | `duty.handover.record` or outgoing person | Record handover |
| `POST /api/v1/duty-assignments/handovers/:hid/acknowledge` | outgoing/incoming person | Acknowledge handover |
| `GET /api/v1/roster?from&to&unitId&category` | `roster.view` (scoped, ≤ 42 days) | Personnel × duties, unavailability, conflicts |
| `GET /api/v1/personnel` · `/stats` · `/:id` | `personnel.view` (scoped); own record always | Directory, counts by class, detail with duty history |
| `POST /api/v1/personnel` · `PATCH /:id` · `POST /:id/status` | `personnel.manage` (never on own record) | Create, edit (reason), activate/deactivate (reason) |
| `POST /api/v1/personnel/:id/unavailability` · `…/:uid/cancel` | `availability.manage` | Record / cancel unavailability (conflicts flagged) |
| `GET /api/v1/units` | any | Unit tree |
| `GET/POST /api/v1/accounts` · `PATCH /:id` · `POST /:id/reset-password` | `users.manage` (never own account) | Login accounts, role/status change (sessions revoked) |
| `GET /api/v1/policy/duty-categories` | any | Category policy and eligibility |
| `PATCH /api/v1/policy/duty-categories/:code` | `policy.manage` | Edit policy (versioned, audited, reason) |
| `GET /api/v1/policy/roles` · `PUT /roles/:code/permissions` | `policy.manage` / `users.manage` (read); `policy.manage` (write) | Role–permission matrix |
| `GET /api/v1/checkins` | `checkin.view` (scoped, restricted filtered) | Check-ins with duty link, device vs server times, location provenance, corrections |
| `GET/POST /api/v1/corrections` · `POST /:id/decide` | `correction.request` / `correction.approve` (decider ≠ requester) | Audited corrections |
| `GET /api/v1/exceptions/:id` · `POST /:id/notes` · `POST /evaluate` | `exception.view` / `exception.manage` | Detail with notes and audited history; investigation notes; run evaluator |
| `GET /api/v1/dashboard/alerts?assignmentId&category…` | `exception.view` (scoped) | Exceptions list (extended filters) |
| `GET /api/v1/dashboard/operations?from&to&category&unitId&officerId` | `dashboard.view` (scoped) | Operational overview counts |
| `GET /api/v1/me/summary` | any | Personal duties, pending acknowledgements, sync status, counts |
| `GET /api/v1/notifications` · `POST /:id/read` · `POST /read-all` | any (own) | In-app notifications; GET marks QUEUED → DELIVERED |
| `GET /api/v1/reports/summary` | `reports.view` | Row counts / previews per report |
| `GET /api/v1/reports/:kind.(csv\|pdf)` | `reports.export` (scoped; audited with SHA-256) | `kind` = `roster`, `assignments`, `completion`, `exceptions`, `evidence-verification` |
| `GET /api/v1/system/status` | `system.health` | Measured API/DB/storage/sync/audit/backup status |
| `GET /api/v1/duties` (extended) | `duty.view` | Each session now includes `assignment` (category, reference, restricted-aware details, latest instructions, check-in policy); drafts hidden from SELF scope |
