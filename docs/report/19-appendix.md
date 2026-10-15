# Appendix

## A. Recorded end-to-end run (simulated device)
Run at 2026-10-13T06:36:41.551Z against the local API (`pnpm simulate`). The device is a **simulator** producing
correctly signed events with synthetic sensor values; it demonstrates server behaviour, not phone behaviour.

| # | Step | Outcome |
|---|---|---|
| 1 | API readiness (/ready) | HTTP 200 {"database":"ok","postgis":"3.4.2","migrations":"5","storage":"ok"} |
| 2 | Officer signs in on the (simulated) duty device | HTTP 200; refresh token returned to device only |
| 3 | Register demonstration device public key | HTTP 201; status PENDING; fingerprint 9e06f2651f9591fb… |
| 4 | Sync before administrator approval is refused | HTTP 403 DEVICE_NOT_APPROVED |
| 5 | Administrator approves the device (fingerprint verified out of band) | HTTP 200 ACTIVE |
| 6 | Start duty session, record location and capture evidence; sync online | HTTP 200 counts={"accepted":3,"duplicate":0,"rejected":0,"conflict":0} head=#3 |
| 7 | Upload evidence bytes; server recomputes SHA-256 | HTTP 200 VERIFIED |
| 8 | Inspect the local manifest and hash | image SHA-256 7cdf7533d3555044…, written to local-manifest-example.json |
| 9 | Network disconnected: device records check-in (missed → late), transit, locations, a mock-location fix, evidence and a clock anomaly locally | 11 events queued (seq 4..14); nothing sent |
| 10 | App/service restart while offline (simulated) | Queue is held in the persistent outbox; sequence numbers continue (see mobile tests "never resets sequence numbers") |
| 11 | Network restored: queued batch synchronised | HTTP 200 counts={"accepted":11,"duplicate":0,"rejected":0,"conflict":0} serverReceivedAt=2026-10-13T06:36:41.059Z |
| 12 | Duplicate upload of the same batch (e.g. response lost) | HTTP 200 replayed=true; no duplicate records |
| 13 | Same events re-sent in a new batch | statuses=DUPLICATE,DUPLICATE,DUPLICATE |
| 14 | Upload second evidence (periodic pattern) | HTTP 200 VERIFIED |
| 15 | Deliberately corrupted event payload (coordinates edited after signing) | REJECTED EVENT_HASH_MISMATCH |
| 16 | Forged client hash (recomputed, but old signature) | REJECTED INVALID_SIGNATURE |
| 17 | Corrupted evidence bytes uploaded | HTTP 422 EVIDENCE_HASH_MISMATCH (quarantined, original declaration preserved) |
| 18 | Dashboard observation (last known) | RECENTLY_RECEIVED ; spatial=INSIDE_ASSIGNED_ZONE; accuracy=8 m |
| 19 | Review flags raised for supervisor (prompts, not conclusions) | CHAIN_LINK_MISMATCH, CHECKIN_LATE, CHECKIN_MISSED, CLOCK_ANOMALY, DEVICE_REGISTRATION, EVIDENCE_HASH_MISMATCH, INVALID_DEVICE_SIGNATURE, MOCK_LOCATION_INDICATOR, SCREEN_RECAPTURE_RISK, SPATIAL_ZONE_EXCEPTION |
| 20 | PostGIS spatial-zone checks on synchronised observations | EVIDENCE_CAPTURED:INSIDE_ASSIGNED_ZONE / EVIDENCE_CAPTURED:INSIDE_ASSIGNED_ZONE / LOCATION_OBSERVED:INSIDE_ASSIGNED_ZONE / LOCATION_OBSERVED:OUTSIDE_ASSIGNED_ZONE(404.9 m) / EVIDENCE_CAPTURED:INSIDE_ASSIGNED_ZONE / LOCATION_OBSERVED:INSIDE_ASSIGNED_ZONE |
| 21 | Export evidence package and verify it independently (no API/dashboard involved) | PASS; 17 checks; package SHA-256 2aec26dfcc6155a3… |
| 22 | Modify ONE bit of the image in a copy of the package and verify again | FAIL: file.evidence/original.jpg, image.sha256 |
| 23 | Generate evidence report PDF | HTTP 200, 4529 bytes |
| 24 | Verify the server audit (chain-of-custody) hash chain | ok=true; 17 records; head #17 |

## B. Independent verifier output (genuine package)
```text
PRAMAAN evidence package verification
Package : docs/demo-run/sample-evidence-package.zip
Evidence: a48e2aab-da17-4272-8ae2-6ab3177ed0c4

[PASS      ] index.format
             Format PRAMAAN-EVIDENCE-PACKAGE-1
[PASS      ] file.evidence/original.jpg
             SHA-256 7cdf7533d3555044de2c3d4710e84685152ce278e9a1ad303e1f38e4b363b18e
[PASS      ] file.evidence/manifest.json
             SHA-256 b1ddef7373143289a81340089da2568df26228781bf0ceb54b6fcb03006f01f2
[PASS      ] file.ledger/events.json
             SHA-256 90a38541a380aca1958c323d22f7d10913c5f12f8d93f01152e3a0a80a195bac
[PASS      ] file.device/public-key.json
             SHA-256 e10befb44d89e0fa5c732371f244856abd1f64af521f943f2b954048c84f8bbb
[PASS      ] file.server/verification.json
             SHA-256 91e1263eb2f302a34417705e5b89acde1c7a3f77ab176dc69185b1137acbf178
[PASS      ] file.custody/audit-events.json
             SHA-256 7479001b82a1fbc6a489d4c9ffaac4e30a36f9c1679f8f7e4f14a636182bc9e6
[PASS      ] image.signature
             JPEG file signature present
[PASS      ] image.sha256
             computed 7cdf7533d3555044de2c3d4710e84685152ce278e9a1ad303e1f38e4b363b18e, manifest 7cdf7533d3555044de2c3d4710e84685152ce278e9a1ad303e1f38e4b363b18e
[PASS      ] image.length
             computed 25072 bytes, manifest 25072
[PASS      ] manifest.metadata
             Required metadata present and plausible
[PASS      ] ledger.manifestHash
             computed a36b98303cc0a3a3ca56f2b8a5c8ca79ca6e0f4fd19e3e78a92689458e6bd5bd, event a36b98303cc0a3a3ca56f2b8a5c8ca79ca6e0f4fd19e3e78a92689458e6bd5bd
[PASS      ] ledger.imageHash
             Capture event image hash vs manifest
[PASS      ] ledger.manifestCopy
             Manifest file equals manifest embedded in the signed event
[PASS      ] ledger.chain
             15 events (seq 1..15) hash-verified and linked
[PASS      ] ledger.signatures
             15 ECDSA-P256 signatures valid for the registered device key (key status at export: ACTIVE)
[PASS      ] custody.records
             1 custody record hashes verified (links verifiable against the full server audit chain only)

RESULT: PASS

A PASS confirms only the cryptographic and structural checks listed. It does not prove that the photographed scene, the recorded time, the location or the identity of the person are genuine.
exit=0
```

## C. Verifier output after flipping one bit of the image (failing checks only)
```text
[FAIL      ] file.evidence/original.jpg
[FAIL      ] image.sha256
RESULT: FAIL
exit=1
```

## D. Architecture decision records
## ADR-001 — Monorepo layout and technology stack

**Status:** Accepted · **Date:** 2026-10-13

#### Context
PRAMAAN needs an Android duty app, an API, a supervisory dashboard and one shared definition of
how events are canonicalised and hashed. A hash computed differently by two components would make
every integrity check meaningless.

#### Decision
- One repository. `packages/event-contracts` (canonical JSON, hashing, chain/clock/rules logic),
  `packages/validation` (zod schemas) and `packages/verifier` (independent package verifier) are
  consumed by the API, the dashboard tooling and — from source, via Metro — the mobile app.
- API: Node.js 22 LTS + TypeScript (strict) + Express 5 + `pg` (raw SQL).
- Database: PostgreSQL 16 + PostGIS 3.4.
- Dashboard: React 19 + Vite + Tailwind CSS 3 + React-Leaflet.
- Mobile: React Native CLI 0.87 (no Expo) + Kotlin native modules.
- pnpm workspace for API/dashboard/packages; the React Native app is installed with **npm** outside
  the workspace because the RN Gradle plugin and autolinking expect a conventional `node_modules`
  beside `android/`.

#### Consequences
- The same `computeEventHash` code runs on the phone, the server and in the verifier.
- Two package managers must be documented (pnpm + npm); the mobile app pins its own copies of
  `@noble/hashes` and `zod` that Metro resolves for the shared sources.

## ADR-002 — Canonical JSON (RFC 8785 subset) and SHA-256 event hashing

**Status:** Accepted

#### Decision
- Event bodies are serialised with *PRAMAAN-CJSON-1*: keys sorted by UTF-16 code units, no
  whitespace, ECMAScript number/string serialisation (as RFC 8785), and **rejection** (not silent
  dropping) of `undefined`, `NaN`, `Infinity`, functions and non-plain objects.
- `eventHash = SHA-256(UTF-8(canonical(body)))` where *body* is a fixed list of 15 fields
  (`schemaVersion … payload, previousEventHash`). Mutable sync fields (state, retries, server
  receipt time) are excluded so historical hashes never change.
- The first event of a device links to `GENESIS_HASH` (64 zeros).
- SHA-256 implementation: `@noble/hashes` in shared code (works in Hermes, Node and browsers);
  `node:crypto` for large file hashing on the server.

#### Rejected alternatives
- `JSON.stringify` with insertion order — not deterministic across producers.
- Custom hash constructions — forbidden; only standard primitives are used.

## ADR-003 — ECDSA P-256 device signatures in Android Keystore

**Status:** Accepted

#### Context
A hash only proves that content is unchanged since it was hashed; a modified client can hash
fabricated data. Events must therefore be bound to a key that cannot be exported from the
registered phone.

#### Decision
- Each device generates an **EC P-256** key pair in **Android Keystore** (StrongBox when available,
  else TEE) — algorithm `SHA256withECDSA`, signature encoded as DER, public key as X.509 SPKI.
- Ed25519 was considered but P-256 is supported by Android Keystore on every API level ≥ 24 and is
  verified natively by Node.js `crypto.verify`.
- Signed message: `"PRAMAAN-EVENT-V1:" + eventHash` (domain separation).
- Registration sends only the public key; an **administrator approves** it after comparing the
  SHA-256 fingerprint with the officer (out-of-band). Revocation stops ingestion immediately.
- A separate auth-per-use EC key (`setUserAuthenticationRequired`, BIOMETRIC_STRONG) signs a nonce
  during each check-in, giving hardware-attested evidence that BiometricPrompt succeeded.

#### Consequences / limits
- Reinstalling the app deletes Keystore keys → a new device registration is required.
- A rooted/instrumented phone can still *use* the key to sign fabricated events; signatures prove
  "produced by software holding this device key", not truthfulness.

## ADR-004 — Append-only ledger, persistent outbox and idempotent batch ingestion

**Status:** Accepted

#### Decision
- Device: every append is one SQLCipher transaction (ledger row + outbox row + head update).
- Outbox rows are assigned to a `batchId` and keep it until the server answers, so a retry after a
  timeout, crash or lost response is a byte-identical replay.
- Server: `batchId` is an idempotency key (identical replay → stored response; different content →
  409). Event IDs and `(deviceId, sequence)` are unique. Per-event results are returned
  (`ACCEPTED | DUPLICATE | REJECTED | CONFLICT`); all of them are committed atomically with the
  batch, while any unexpected server error rolls back the entire batch.
- Conflicting duplicates are preserved in `ingestion_conflicts`; rejected submissions are preserved
  in `ingestion_rejections`. No last-write-wins.
- Gaps are accepted with `chain_link_status = GAP_BEFORE` and a review flag; a later "late fill" is
  verified against both neighbours. Gaps are never silently repaired.
- The device never deletes an event because an HTTP call succeeded; compaction is a separate,
  retention-driven step that keeps (sequence, hash, previous hash) in `ledger_archive`.

## ADR-005 — Forward-only SQL migrations with checksums

**Status:** Accepted

#### Decision
A small migration runner (`apps/api/src/database/migrate.ts`) applies `database/migrations/NNNN_*.sql`
in order, each in its own transaction, records a SHA-256 checksum in `schema_migrations`, refuses to
run if an applied file was edited, and uses a PostgreSQL advisory lock against concurrent runners.
Plain SQL was chosen over an ORM migration DSL so that PostGIS types, triggers and partial indexes are
expressed exactly and reviewed as SQL.

#### Rollback
Forward-only: a faulty migration is corrected by a new migration. Disaster recovery uses
`pg_dump`/`pg_restore` (see `scripts/backup-restore-check.sh`), which was exercised on a clean database.

## ADR-006 — Trusted-time model (wall clock + monotonic clock + server anchor)

**Status:** Accepted

An offline phone cannot know authoritative time. Each event stores the device wall clock (untrusted),
`SystemClock.elapsedRealtime()` and a boot identifier. Every successful sync records a server time
anchor; while the boot is unchanged the estimate is `anchor.serverTime + (monotonic − anchor.monotonic)`
with uncertainty `50 ms + RTT/2 + 100 ppm × elapsed`. After a reboot the estimate is `null`
(`DEVICE_WALL_CLOCK_UNANCHORED`). Rollback, forward jumps and wall/monotonic divergence produce
`CLOCK_ANOMALY_DETECTED` events. Original timestamps are never rewritten; the server separately stores
`server_received_at` and `server_processed_at`.

## ADR-007 — Evidence capture, sealing and storage

**Status:** Accepted

- Capture only through an unexported CameraX activity; no gallery, picker or share-target path exists.
- The JPEG is streamed once through SHA-256 and AES-256-GCM (Keystore key) into
  `files/evidence/<random>.enc`; the plaintext temp file is deleted. Interrupted seals (`*.part`) are
  removed at start-up.
- The authoritative record is the canonical manifest (bound to the image hash) embedded in a signed
  `EVIDENCE_CAPTURED` event — EXIF is not relied upon.
- Server: bytes are streamed through SHA-256 with a hard size limit, file-signature checked, compared
  with the signed declaration, stored under random names, re-verified on every read/export.
  Mismatches are quarantined (kept), never accepted.
- Server storage driver: local filesystem, which on Render MUST be a persistent disk. Object storage
  is future work (documented, not implemented).

## ADR-008 — Authentication and session handling

**Status:** Accepted

- Passwords: Argon2id (`@node-rs/argon2`, m = 19 MiB, t = 2, p = 1); account lock after 5 failures for 15 min;
  timing equalisation for unknown accounts.
- Access tokens: HS256 JWT, 15 min, held **only in memory** in the dashboard and mobile app.
- Refresh tokens: 256-bit random, stored server-side only as SHA-256, rotated on every use; reuse of a
  rotated token revokes the whole token family. Dashboard: httpOnly cookie scoped to `/api/v1/auth`
  plus a mandatory custom header (CSRF defence). Mobile: stored inside the SQLCipher database.
- Every request re-checks that the user is active and the session family not revoked, so logout and
  device revocation take effect immediately.
- Roles: ADMIN, SUPERVISOR (DSP/SHO-style), REVIEWER (read-only, no image content), OFFICER (mobile only). **Superseded in 2.0 by ADR-009** (database-backed permissions and scopes; rank roles HG…DSP).
- 2.0: every request also re-reads the role, permissions, scope and the linked personnel record’s active status; demo accounts are refused in production unless `ALLOW_DEMO_LOGIN=true`.

## ADR-009 — Database-backed permissions and data scopes instead of fixed roles

**Status:** Accepted (PRAMAAN 2.0)

#### Context
PRAMAAN 1.0 had four hard-coded roles (`ADMIN`, `SUPERVISOR`, `REVIEWER`, `OFFICER`) checked with
`requireRole(...)`. The 2.0 brief needs separate accounts for HG, PC (AR and General), HC, ASI, SI, CI and DSP.
It also requires least privilege, no automatic “higher rank can do everything”, scope boundaries, and
configurability, because the departmental rules are not yet known.

#### Decision
* Store `roles`, `permissions` and `role_permissions` in the database. Each role has a `scope_level`:
  SELF, UNIT, UNIT_TREE or ALL.
* Keep the access token minimal (user id, session family). Re-read role, permissions, scope, and account and
  personnel status on **every** request.
* Replace `requireRole` with `requirePermission` / `requireAnyPermission`. Apply scope in SQL with shared
  helpers that return 404 for out-of-scope objects. Apply restricted-duty rules through a separate SQL filter.
* Keep AR/General as a personnel attribute. It confers no permissions.
* Keep the 1.0 roles with equivalent permission sets for backward compatibility.

#### Consequences
* There is one extra query per request. It is acceptable at prototype scale and could be cached later with
  short-lived invalidation.
* Permission changes take effect immediately. A tampered or stale token cannot widen access.
* Every list query must include a scope predicate. This is enforced by convention and covered by tests
  (scope boundaries, restricted details, scoped reports).

## ADR-010 — Duty assignments layered over per-person duty sessions

**Status:** Accepted (PRAMAAN 2.0)

#### Context
The 1.0 `duty_sessions` table represents one officer's authorised window, which device events reference. The
2.0 duty categories need one operational duty with several people, plus staffing changes, instructions,
handovers and a status life cycle. All of this must happen without breaking device synchronisation or the
evidence pipeline.

#### Decision
* Add `duty_assignments` (the operation) and `duty_assignment_personnel` (the people). When a duty is
  published, each person gets an ordinary `duty_sessions` row, linked 1:1 from the personnel row.
* Device events keep referencing `dutySessionId`. Ingestion is unchanged, except that a
  `DUTY_SESSION_STARTED` also moves the assignment to `IN_PROGRESS`, with an explicit “not proof of
  attendance” reason.
* Removing or replacing a person cancels only a session that never started. Drafts never reach devices.
* All changes are written to an append-only change table plus the audit chain. Assignments, personnel rows
  and personnel records cannot be deleted.

#### Consequences
* Existing check-in, evidence, spatial and exception logic applies to every category without duplication.
* Reports and exceptions join through the session to reach the assignment.
* A person's schedule lives in two places (the assignment and each session). Planned sessions are updated
  together with the assignment. Active sessions are left for the device to end.

## E. Scenario demonstration run (simulated devices)

Generated 2026-10-15T12:30:36.883Z by `pnpm scenarios` against the seeded API: **42/42 checks passed**. Devices are simulated (signed events with synthetic locations and images).

| # | Scenario | Check | Observed | Result |
|---|---|---|---|---|
| 1 | Setup | API ready | HTTP 200 {"database":"ok","postgis":"3.4.2","migrations":"7","storage":"ok"} | PASS |
| 2 | Setup | All eight rank accounts sign in | hg, pc, pc.ar, hc, asi, si, ci, dsp signed in | PASS |
| 3 | Four duty categories | CI lists TRAIN_BEAT | 4 duty/duties | PASS |
| 4 | Four duty categories | CI lists STATION_WATCH | 3 duty/duties | PASS |
| 5 | Four duty categories | CI lists VIP_ESCORT | 1 duty/duties | PASS |
| 6 | Four duty categories | CI lists TRACK_INCIDENT | 1 duty/duties | PASS |
| 7 | Train beat (AR + AR) with check-ins | SI creates and publishes a beat with two AR constables | HTTP 201 ASSIGNED TB-20261015-001 | PASS |
| 8 | Train beat (AR + AR) with check-ins | PC (AR) acknowledges published instructions | HTTP 200 | PASS |
| 9 | Train beat (AR + AR) with check-ins | Device syncs duty start, check-ins and a missed check-in | {"accepted":7,"duplicate":0,"rejected":0,"conflict":0} | PASS |
| 10 | Train beat (AR + AR) with check-ins | Device-reported start moves the duty to IN_PROGRESS | IN_PROGRESS | PASS |
| 11 | Train beat (AR + AR) with check-ins | Check-ins link to personnel and duty | 2 rows; Vemuri Anil Kumar:MISSED, Vemuri Anil Kumar:ACKNOWLEDGED | PASS |
| 12 | Train beat (AR + AR) with check-ins | Missed check-in raised as an exception visible to the ASI | 1 | PASS |
| 13 | Station watch (HG + General) offline synchronisation | SI publishes a station watch (HG + PC General) | HTTP 201 SW-20261015-001 | PASS |
| 14 | Station watch (HG + General) offline synchronisation | Events recorded offline for 85 min sync when connectivity returns | {"accepted":6,"duplicate":0,"rejected":0,"conflict":0} | PASS |
| 15 | Station watch (HG + General) offline synchronisation | Lost response → same batch replayed | replayed=true | PASS |
| 16 | Station watch (HG + General) offline synchronisation | Same events in a new batch | {"accepted":0,"duplicate":6,"rejected":0,"conflict":0} | PASS |
| 17 | Station watch (HG + General) offline synchronisation | Handover recorded with outstanding tasks | HTTP 201; warnings: Incoming person is not listed on this duty. | PASS |
| 18 | Overlapping assignment | Assigning an already-engaged constable | HTTP 409 ASSIGNMENT_CONFLICT: Overlaps duty TB-20261015-001 (IN_PROGRESS). | PASS |
| 19 | Overlapping assignment | HC (no duty.assign) attempts an override | HTTP 403 | PASS |
| 20 | Overlapping assignment | SI overrides with a reason | HTTP 201 | PASS |
| 21 | Overlapping assignment | Inactive personnel cannot be newly assigned | HTTP 400 INACTIVE_PERSONNEL | PASS |
| 22 | VIP escort restriction | DSP opens the restricted escort | title="VIP Escort (restricted details)" escortLabel=null | PASS |
| 23 | VIP escort restriction | SI (duty.view_restricted) opens it | escortLabel=DEMO-VIP-A (synthetic label) | PASS |
| 24 | Track incident evidence integrity | In-app evidence upload (non-graphic synthetic image) | HTTP 200 VERIFIED | PASS |
| 25 | Track incident evidence integrity | Modified image bytes are uploaded | HTTP 422 EVIDENCE_HASH_MISMATCH | PASS |
| 26 | Track incident evidence integrity | HC (no restricted access) opens incident evidence | HTTP 404 | PASS |
| 27 | Track incident evidence integrity | DSP (no evidence.view_image) requests image bytes | HTTP 403 | PASS |
| 28 | Track incident evidence integrity | CI exports the evidence package; independent verifier | PASS (17 checks) | PASS |
| 29 | Unauthorised access | HG → accounts | HTTP 403 | PASS |
| 30 | Unauthorised access | HG → audit | HTTP 403 | PASS |
| 31 | Unauthorised access | DSP → system status | HTTP 403 | PASS |
| 32 | Unauthorised access | HG → another person | HTTP 404 | PASS |
| 33 | Supervisory review of exceptions | ASI runs the duty-exception evaluator | {"evaluatedAt":"2026-10-15T12:30:36.536Z","reportingDelayed":11,"overdue":2,"syncFailures":0} | PASS |
| 34 | Supervisory review of exceptions | Acknowledge → investigation note → resolve | 201/200 RESOLVED | PASS |
| 35 | Supervisory review of exceptions | Audited correction requested by PC (AR), approved by SI | 201/200 (personnel row 741c0b5d) | PASS |
| 36 | Supervisory review of exceptions | Invalid transition (cancel a completed duty) | HTTP 409 INVALID_TRANSITION | PASS |
| 37 | Reports | CI exports roster PDF | HTTP 200 sha256 55a16fd728e5ef6b… | PASS |
| 38 | Reports | CI exports assignments PDF | HTTP 200 sha256 bac52b0ead4df89f… | PASS |
| 39 | Reports | CI exports completion PDF | HTTP 200 sha256 fdd0137ac75dc77b… | PASS |
| 40 | Reports | CI exports exceptions PDF | HTTP 200 sha256 26cf8a9930ad22bf… | PASS |
| 41 | Reports | CI exports evidence-verification PDF | HTTP 200 sha256 6dc2c523e94e6b47… | PASS |
| 42 | Reports | Audit chain after all scenarios | ok=true checked=114 | PASS |
