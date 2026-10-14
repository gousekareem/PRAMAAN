# Requirement traceability and feature completion matrix

Statuses: **Implemented and Verified** (automated test or recorded run in this delivery) ·
**Implemented but Not Verified** (code present; needs Android hardware/SDK or credentials) ·
**Partial** · **Not Implemented** · **Not Applicable**.

| Req. | Requirement | Source files | Test / evidence | Status |
|---|---|---|---|---|
| 6.1 | Randomised 90–150 min schedule, 3-min window, CSPRNG, persisted, no duplicates | `apps/mobile/src/checkins/checkinEngine.ts`, `storage/migrations.ts` (unique partial index) | `checkins.test.ts` (window, non-fixed, duplicates, restart) | Implemented and Verified |
| 6.1 | Quiet periods, duty end bound, escalation count | `checkinEngine.ts` | `checkins.test.ts` | Implemented and Verified |
| 6.2 | AlarmManager exact/inexact, notification channels, boot recovery | `duty/CheckinAlarmReceiver.kt`, `BootReceiver.kt`, `Notifications.kt` | device checklist 9, 12, 17 | Implemented but Not Verified |
| 6.2 | WorkManager deferrable work | — (foreground service + AlarmManager used instead; see limitations) | — | Not Implemented |
| 6.3 | Biometric (BIOMETRIC_STRONG, CryptoObject) then 3-digit code in 5 s | `security/PramaanSecurityModule.kt`, `screens/CheckinScreen.tsx`, `checkinEngine.ts` | `checkins.test.ts` (challenge logic); device checklist 10–11 | Partial (logic verified, native prompt not verified) |
| 6.4 | Missed / late recorded separately with reason codes | `checkinEngine.ts`, `api/src/ingestion/derive.ts` | `checkins.test.ts`, `domain.test.ts` | Implemented and Verified |
| 7.1 | No gallery/import path; in-app camera only | `evidence/CaptureActivity.kt` (unexported), `CaptureScreen.tsx`; manifest requires `IN_APP_CAMERA` | manifest tests; device checklist 14 | Partial (server/schema enforced; camera not run) |
| 7.2 | Capture metadata incl. location, mock, cell (never fabricated), steps, posture, app version | `evidenceService.ts`, `PramaanDutyModule.kt`, `DevicePosture.kt` | `evidence.test.ts` (mobile) | Partial (JS verified; native collectors not run) |
| 7.3 | Trusted-time model, anomaly detection, originals preserved | `event-contracts/src/clock.ts`, `ledger.ts` | `clock.test.ts`, `ledger.test.ts`, `sync.test.ts` (API) | Implemented and Verified |
| 7.4 | Canonical manifest bound by hash (no reliance on EXIF) | `manifest.ts`, `evidenceService.ts` | manifest tests, verifier tests | Implemented and Verified |
| 7.4 | Visible watermarked derivative | manifest field `derivatives` only | — | Not Implemented |
| 7.5 | SHA-256 flow, signing, protected storage | `CryptoFormat.kt`, `PramaanEvidenceModule.kt`, `ledger.ts` | `CryptoFormatTest.kt` (JVM), mobile tests | Partial (Keystore path not run) |
| 7.6 | Experimental screen-recapture detector | `event-contracts/src/screen-risk.ts`, `evidence/screen-analysis.ts` | `manifest-screen.test.ts` incl. false-positive case | Implemented and Verified (experimental) |
| 7.7 | Encrypted files, random names, interrupted-write recovery, no deletion before sync | `PramaanEvidenceModule.kt`, `sync/retention.ts` | `CryptoFormatTest`, retention test | Partial (native not run) |
| 8.1 | Foreground service (type location), lifecycle recording | `duty/DutyMonitorService.kt` | device checklist 7, 16 | Implemented but Not Verified |
| 8.2 | Step, accelerometer, GPS, speed, accuracy, motion state, battery-aware sampling | `DutyMonitorService.kt`, `observationProcessor.ts` | mobile `evidence.test.ts` (processing) | Partial |
| 8.3 | Movement inconsistency rule with suppressions and stored inputs | `event-contracts/src/rules.ts`, `api/src/ingestion/derive.ts` | `rules.test.ts`, `domain.test.ts` | Implemented and Verified |
| 8.4 | Transit (> ~60 km/h on reliable fixes) | `rules.ts` `TransitDetector`, `observationProcessor.ts` | `rules.test.ts`, mobile processing test | Implemented and Verified |
| 8.5 | Sensor event model | `event-contracts/src/event.ts`, `validation/src/index.ts` | `validation.test.ts` | Implemented and Verified |
| 9.1–9.2 | Event structure, deterministic hash chain, gaps reported | `event.ts`, `chain.ts`, `ledger.ts` | `chain.test.ts`, `ledger.test.ts` | Implemented and Verified |
| 9.3 | SQLCipher schema with all listed tables | `storage/migrations.ts`, `storage/opsqlite.ts` | schema exercised on SQLite in tests; encryption guard test (mocked native) | Partial (SQLCipher at runtime not verified) |
| 9.4 | Sync: auth, lock, bounded batches, idempotency key, confirmed-only ACK, backoff + jitter, captive portal/timeouts/TLS/5xx/expired auth | `sync/syncEngine.ts`, `sync/http.ts`, `sync/backoff.ts` | `sync.test.ts` (mobile, 12 tests) | Implemented and Verified |
| 9.5 | No delete after HTTP success; retention compaction | `syncEngine.ts`, `retention.ts` | mobile tests | Implemented and Verified |
| 9.6 | Conflict classes (duplicate, gap, conflicting duplicate, invalid signature/hash, unauthorised device, expired duty, stale registration, schema version) | `api/src/ingestion/ingest.ts` | API `sync.test.ts` | Implemented and Verified |
| 10.1 | Entities, constraints, indexes | `database/migrations/*.sql` | migrations applied in every API test run | Implemented and Verified |
| 10.2 | PostGIS queries (contains/covers, distance, outside boundary, recent observations) | `spatial/zones.ts`, `routes/dashboard.ts`, `derive.ts` | `domain.test.ts` | Implemented and Verified |
| 10.3 | `POST /api/v1/sync/batch` validation set, transactions | `ingest.ts` | API tests + demo run | Implemented and Verified |
| 10.4 | Server-side image hash verification + quarantine | `evidence/upload.ts` | `evidence.test.ts` | Implemented and Verified |
| 10.5 | Mock-location risk handling (not sole basis) | `derive.ts` | `domain.test.ts` | Implemented and Verified |
| 10.6 | Listed endpoints, RBAC, validation, pagination, request IDs | `apps/api/src/routes/*` | `auth.test.ts` etc. | Implemented and Verified |
| 10.7 | SSE updates, stale labels | `routes/dashboard.ts`, `hooks/useLiveStream.ts`, `Badges.tsx` | `domain.test.ts` freshness; dashboard tests; screenshot shows "Updates on" | Implemented and Verified |
| 11 | Dashboard pages (overview, map, officers, evidence, alerts, audit, devices, duties) | `apps/admin/src/pages/*` | 28 dashboard tests; real screenshots | Implemented and Verified |
| 11 | Footer © notice + LinkedIn link on all pages | `components/layout/AppFooter.tsx`, `AppLayout.tsx`, `LoginPage.tsx` | `footer.test.tsx` (8 routes) | Implemented and Verified |
| 12.1–12.2 | Standard crypto, key management | see `docs/security-model.md` | tests above | Partial (Keystore not run) |
| 12.4 | Root/debug/signature checks; Play Integrity adapter disabled | `DevicePosture.kt`, `PostureRules.kt` | `DevicePostureTest.kt` (JVM) | Partial |
| 12.5 | HTTPS, limits, rate limits, CORS, headers, redaction | `app.ts`, `logger.ts`, `config/env.ts` | `auth.test.ts` | Implemented and Verified |
| 13 | Privacy and governance controls | `docs/privacy-governance.md`, manifest, retention table | review | Partial (automated purge not implemented by design) |
| 14 | Threat matrix (38 threats) | `docs/threat-matrix.md` | — | Implemented and Verified (document) |
| 15 | Migrations, seeds (fictional), lon/lat docs, original vs derived | `database/` | API tests | Implemented and Verified |
| 17–18 | Windows guide, Render guide | `docs/PRAMAAN_WINDOWS_AND_RENDER_DEPLOYMENT_GUIDE.md` | Windows/Render steps not executed | Implemented but Not Verified |
| 18 | Render deployment | `deploy/render.yaml` | no credentials | Implemented but Not Verified (not deployed) |
| 19 | Error format and status codes, partial-batch semantics | `middleware/errors.ts`, `docs/api-reference.md` | API tests | Implemented and Verified |
| 20 | Automated tests | all `tests/` dirs | `docs/results/test-results.md` | Implemented and Verified |
| 20.6 | Android project builds | `apps/mobile/android` | Gradle not runnable (no SDK); Metro release bundle built | Implemented but Not Verified |
| 21 | Bounded batches/memory, pooling, backoff, graceful shutdown, benchmarks | `syncEngine.ts`, `pool.ts`, `server.ts`, `benchmark.ts` | `docs/performance.md` | Implemented and Verified |
| 22 | Demo workflow + viva | `docs/demo-script.md`, `simulate-device.ts` | `docs/demo-run/demo-run.json` | Implemented and Verified (simulated) |
| A | Hash-linked chain of custody with verification | `services/audit.ts`, `event-contracts/src/audit-chain.ts` | `domain.test.ts` tamper detection | Implemented and Verified |
| C | Independent verifier (PASS/FAIL/INCOMPLETE) | `packages/verifier` | `verify.test.ts`, demo steps 21–22 | Implemented and Verified |
| D | Recovery/resilience tests | mobile + API tests | listed in `docs/testing.md` | Implemented and Verified (insufficient-storage handling: Partial — warning only) |
| Exports | JSON manifest, CSV, PDF report, package ZIP — access-controlled and audited | `routes/evidence.ts`, `routes/patrol-logs.ts`, `evidence/export.ts` | `evidence.test.ts`, `domain.test.ts` | Implemented and Verified |
| DR | Backup and restore into clean DB | `scripts/backup-restore-check.sh` | `docs/results/backup-restore-check.txt` | Implemented and Verified |
| Final | Read-only reviewer mode | REVIEWER role | `auth.test.ts`, `pages.test.tsx` | Implemented and Verified |
| Final | Device lifecycle (register, approve, revoke) | `routes/devices.ts`, `DevicesPage.tsx` | `sync.test.ts` lifecycle | Implemented and Verified |
| Final | Artifact SHA-256 checksums | `MANIFEST.sha256` (every file in the ZIP); deliverable checksums in the hand-over summary | packaging step | Implemented and Verified |
