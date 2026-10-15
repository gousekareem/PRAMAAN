# Architecture

PRAMAAN is an **academic prototype** of an offline-first duty-accountability platform. It combines
independent observations (check-ins, device-held signatures, location, steps, controlled camera
captures, clock behaviour) with cryptographic integrity and **human review**. No single observation
is treated as proof of presence or misconduct.

## Components

| Component | Path | Technology | Responsibility |
|---|---|---|---|
| Duty app (Android) | `apps/mobile` | React Native 0.87 (CLI) + Kotlin | Check-ins, biometric gate, in-app camera, sensors, encrypted ledger, sync |
| Native modules | `apps/mobile/android/app/src/main/java/com/pramaan/mobile` | Kotlin, CameraX, BiometricPrompt, Keystore | Keys, signing, sealing, foreground service, alarms |
| API | `apps/api` | Node 22, Express 5, `pg` | Auth, permission/scope enforcement, duty operations (2.0), idempotent ingestion, verification, PostGIS, reports/exports, SSE |
| Database | `database/` | PostgreSQL 16 + PostGIS 3.4 | Original observations (append-only), derived records, audit chain |
| Dashboard | `apps/admin` | React 19, Vite, Tailwind, React-Leaflet | Permission-based views for every rank: duties, roster, personnel, check-ins, exceptions, evidence, reports, administration |
| Shared contracts | `packages/event-contracts` | TypeScript | Canonical JSON, hashing, chain, clock, movement rules, screen-risk |
| Validation | `packages/validation` | zod | Envelope, payload and manifest schemas |
| Verifier | `packages/verifier` | TypeScript CLI | Offline verification of exported evidence packages |

## Logical architecture

```mermaid
flowchart TB
  subgraph Device["Android duty device"]
    UI["React Native UI"] --> EV["Application event layer"]
    NAT["Kotlin: Keystore · BiometricPrompt · CameraX · LocationManager · Step counter · AlarmManager · Foreground service"] --> EV
    EV --> VAL["Event validation (zod payload schemas)"]
    VAL --> LED["Hash-linked ledger<br/>canonical JSON → SHA-256 → ECDSA-P256 signature"]
    LED --> DB[("SQLCipher SQLite<br/>ledger · outbox · manifests · schedule")]
    CAM["Sealed evidence files<br/>AES-256-GCM (Keystore key)"]
    DB --> OUT["Persistent sync outbox<br/>bounded batches, fixed batchId"]
  end
  OUT -- "offline: keep queue" --> OUT
  OUT -- "HTTPS, retry + backoff + jitter" --> API
  subgraph Server["PRAMAAN API (Render web service)"]
    API["Auth + RBAC + rate limits"] --> RV["Request validation"]
    RV --> IDEM["Idempotency (batchId, eventId, device sequence)"]
    IDEM --> CRY["Hash recompute · signature verify · chain links · manifest binding"]
    CRY --> TX["Transactional ingestion (savepoint per event)"]
    TX --> PG[("PostgreSQL + PostGIS")]
    TX --> DER["Derived records + review flags<br/>spatial · check-ins · movement · clock"]
    UP["Evidence upload: streaming SHA-256, size + signature checks"] --> FS[("Persistent evidence disk")]
    DER --> SSE["Dashboard API + Server-Sent Events"]
    AUD["Append-only, hash-linked audit log"]
  end
  CAM -. "after event ACK" .-> UP
  SSE --> ADM["React dashboard (DSP / SHO / reviewer)"]
  ADM --> EXP["Exports: package ZIP · manifest JSON · CSV · PDF report"]
  EXP --> VER["Independent verifier CLI"]
```

## Evidence lifecycle (capture → independent verification)

```mermaid
sequenceDiagram
  autonumber
  participant O as Officer
  participant C as CaptureActivity (CameraX)
  participant N as Evidence module (Kotlin)
  participant L as Ledger (JS, SQLCipher)
  participant S as Sync engine
  participant A as API
  participant R as Reviewer / verifier
  O->>C: Open in-app camera (no gallery path)
  C->>N: JPEG written to private cache
  N->>N: stream → SHA-256 + AES-GCM seal, delete plaintext
  N->>L: sealed path, sha256, size, dimensions
  L->>L: manifest (location, cell, steps, posture, times) → manifestSha256
  L->>L: EVIDENCE_CAPTURED {imageSha256, manifestSha256, manifest} → hash-link → sign
  S->>A: POST /sync/batch (event)
  A->>A: recompute event hash, verify signature, verify manifest hash & binding
  A-->>S: ACCEPTED (+ chain head, server time)
  S->>A: PUT /sync/evidence/:id (decrypted temp, re-hashed locally first)
  A->>A: streaming SHA-256 == signed declaration? store : quarantine
  R->>A: GET /evidence/:id/package (audited)
  A->>A: re-verify stored bytes
  R->>R: pramaan-verify package.zip → PASS / FAIL / INCOMPLETE
```

## Trust boundaries

1. **Device ↔ user.** The officer controls the phone. Root, instrumentation or a modified build can
   fabricate sensor values and still sign them. Integrity checks prove *consistency since signing*,
   not truth.
2. **Device ↔ network.** TLS in production; release builds reject cleartext (network security config).
3. **API ↔ database.** Original observations are append-only (triggers); a database owner can
   bypass triggers, which the audit hash chain and external checkpoints make detectable.
4. **Dashboard ↔ API.** Short-lived bearer tokens in memory; refresh cookie httpOnly; RBAC on every
   route; image content restricted to SUPERVISOR/ADMIN.

## Implementation status

| Area | Status |
|---|---|
| Shared contracts, validation, verifier | Implemented and Verified (automated tests) |
| API, PostGIS schema, ingestion, evidence verification, exports, audit chain | Implemented and Verified (integration tests against PostgreSQL 16 + PostGIS 3.4, end-to-end simulation) |
| Dashboard | Implemented and Verified (component tests, production build, real screenshots against the running API) |
| Mobile JS logic (ledger, sync, check-ins, evidence pipeline, retention) | Implemented and Verified (unit tests over the real SQL schema on SQLite; Metro release bundle builds) |
| Kotlin native modules | Implemented but Not Verified (not compiled against the Android SDK here; 7 pure-JVM tests of crypto/posture logic pass) |
| Physical-device behaviour (biometric, camera, Keystore, sensors, foreground service, SQLCipher at runtime) | Implemented but Not Verified — requires a physical Android device (see `docs/device-test-checklist.md`) |
| Render deployment | Configuration provided; **not deployed** (no credentials) |


## PRAMAAN 2.0 operations layer

```mermaid
flowchart LR
  subgraph Web["Dashboard (permission-based navigation)"]
    MY["My duties<br/>HG / PC / PC-AR"] --- OPS["Duty assignments · roster · check-ins<br/>HC / ASI / SI / CI"] --- AGG["Overview · reports · audit<br/>DSP"] --- ADM["Accounts · policy · system status<br/>ADMIN"]
  end
  Web -->|"Bearer token (user id only)"| AUTH["requireAuth: re-read role, permissions,<br/>scope, active status from DB"]
  AUTH --> PERM["requirePermission + SQL scope filters<br/>+ restricted-duty redaction"]
  PERM --> DUTY["Duty service: categories, eligibility, conflicts,<br/>state machine, instructions, handovers"]
  DUTY -->|"publish"| SESS["Per-person duty_sessions"]
  SESS -->|"unchanged 1.0 pipeline"| ING["Device ingestion: signed check-ins, evidence, locations"]
  ING -->|"DUTY_SESSION_STARTED"| DUTY
  ING --> EXC["Exceptions + evaluator<br/>(delayed reporting, overdue, sync failure)"]
  DUTY --> HIST[("Append-only change history<br/>+ hash-linked audit")]
  EXC --> NOTE["Notes · resolution · corrections"]
```

The duty layer does not replace the evidence engine. Every assigned person gets an individual 1.0 duty
session, so signed device events keep flowing through the same verified ingestion path, now linked back to
the operational duty. See `railway-operations.md` and `authorization.md`.
