# Backend architecture

## Request pipeline
`requestId` → pino HTTP logging (redacted) → Helmet (CSP `default-src 'none'`, HSTS in production) →
CORS allowlist → general rate limiter → JSON parser (2 MiB) → cookie parser → per-request timeouts →
routes. Protected routers are mounted behind `requireAuth`, which verifies the JWT and then re-reads from the
database whether the user and the linked personnel record are active, whether the session family has been
revoked, the role, the permission set and the data scope (2.0). `requirePermission` enforces the permission
model, and the SQL helpers in `security/access.ts` restrict every query to the caller's scope and to
restricted-duty rules. Errors are converted to the uniform envelope with
request IDs by `errorHandler`.

## Ingestion (`ingestion/ingest.ts`)
1. Validate the batch envelope (zod) and schema version.
2. `BEGIN`; lock the device row (`FOR UPDATE`) — serialises ingestion per device; check registration,
   approval, revocation and officer ownership.
3. Idempotency: an existing `batch_id` with the same canonical request hash returns the stored response;
   with a different hash → 409.
4. Insert the batch row; sort events by sequence.
5. For each event, inside a **SAVEPOINT**: strict envelope validation → duplicate-in-batch → schema
   version → device/officer match → existing event ID (same hash = `DUPLICATE`, different =
   `CONFLICT` preserved) → recompute canonical hash → verify ECDSA signature with the registered SPKI →
   payload schema → manifest binding for evidence (manifest hash, image hash, IDs, unused evidence ID) →
   sequence slot reuse → duty session ownership and window (trusted estimate if present, else device
   time, ± grace) → chain links to stored neighbours (genesis / linked / gap; late fill verified against
   the next event) → insert the original envelope → advance the chain head → derive records and flags.
6. Store counts and the response JSON; audit `SYNC_BATCH_INGESTED`; `COMMIT`; publish an SSE notice.
Rejections are written to `ingestion_rejections` with the submitted content and its SHA-256.

## Derivation (`ingestion/derive.ts`)
Original events stay immutable; derived rows reference them:
- `patrol_logs` for location-bearing and duty/check-in events with PostGIS classification;
- `evidence_objects` (`AWAITING_UPLOAD`) for `EVIDENCE_CAPTURED`;
- `checkins` lifecycle with precedence rules (acknowledged > late > missed > presented > scheduled);
- review flags with deduplication keys, e.g. one spatial exception per duty-hour;
- server-side movement correlation between consecutive captures using `ST_Distance`, zone sets, step
  counters (same boot only) and suppression on transit/sensor interruption.

## Evidence verification (`evidence/upload.ts`, `export.ts`)
Multipart upload streamed through busboy with a hard size limit into a random temporary file while
hashing; checks: JPEG signature, SHA-256 and byte length equal to the signed declaration. Match →
`VERIFIED` (random file name under `verified/`), experimental screen-risk analysis (jpeg-js decode with
memory/resolution limits). Mismatch → `QUARANTINED` (bytes kept under `quarantine/`), HIGH flag, 422.
Retries are allowed until verified (transit corruption) up to an attempt limit. Every content read and
export re-hashes the stored file; a mismatch raises a HIGH flag and returns 500
`STORED_EVIDENCE_INTEGRITY_FAILURE`.

## Audit / chain of custody (`services/audit.ts`)
Each audit record has a gapless sequence, `previousHash` and `recordHash = SHA-256(canonical(record))`,
appended inside the business transaction while holding a row lock on `audit_chain_head`. UPDATE, DELETE
and TRUNCATE are blocked by triggers. `GET /audit-events/verify` recomputes the whole chain in pages and
checks the head (truncation detection); `GET /audit-events/checkpoint` returns the head for external
retention.

## Real-time updates
`EventBus` (in-process) → `GET /dashboard/stream` (Server-Sent Events, 25 s heartbeats, 30 min max
lifetime to force re-authentication). The dashboard treats events only as "something changed" and
refetches data, so no sensitive content travels on the stream.

## Reliability
Connection pool (10, 5 s connect timeout, 15 s statement timeout), bounded batches (≤ 200 events, device
uses 50), graceful shutdown on SIGTERM (stop accepting, drain, close pool, forced exit after 20 s),
`/health` liveness and `/ready` readiness (DB, PostGIS, migrations, writable storage).


## Duty operations (PRAMAAN 2.0)
* `services/duties.ts` holds the domain logic, independent of HTTP: creating assignments, eligibility and conflict
  checks (`findConflicts`: overlapping assignments, individual sessions and unavailability), adding, removing
  and replacing personnel, the state machine (`TRANSITIONS`), schedule and detail updates, acceptance,
  versioned instructions, handovers, warnings, and `onDeviceDutyStarted`. Ingestion calls the last one in the
  same transaction as a `DUTY_SESSION_STARTED` event. Each mutation writes `duty_assignment_changes` and the
  hash-linked audit log in the caller's transaction.
* Per-person sessions: publishing a duty creates a `duty_sessions` row for every assigned person (zone =
  station/unit illustrative zone, if any). The unchanged ingestion pipeline therefore validates device
  events against each person's planned window.
* `services/exceptions.ts` raises delayed-reporting, overdue and sync-failure exceptions idempotently. It runs
  on a timer in `server.ts` and on demand.
* `services/notifications.ts` queues in-app notifications.
* Routes: `duty-assignments.ts`, `personnel.ts`, `administration.ts` (units, accounts, policy, system status),
  `presence.ts` (roster, check-ins, corrections), `inbox.ts` (notifications, exceptions, operations overview,
  personal summary), `reports.ts` (CSV/PDF via pdfkit).
* `database/demo-operations.ts` is the deterministic synthetic dataset. `tools/scenarios.ts` is the HTTP
  scenario demonstration.
