# Requirements and technology stack

## Functional requirements

| ID | Requirement |
|---|---|
| FR-1 | Officers sign in on a registered device; devices register a public key and need administrator approval. |
| FR-2 | Supervisors authorise duty sessions (≤ 16 h) with assigned patrol zones. |
| FR-3 | During duty the app issues randomised check-ins (90–150 min, 3-min window) requiring BIOMETRIC_STRONG authentication and a 3-digit code typed within 5 s. |
| FR-4 | Missed and late check-ins are recorded as separate events; nothing is rewritten. |
| FR-5 | Evidence is captured only through the in-app camera, hashed, sealed and bound to a signed manifest. |
| FR-6 | Location, steps, motion state, transit suspicion, sensor/permission changes and service lifecycle are recorded during a visible duty session. |
| FR-7 | All events are appended to an encrypted, hash-linked, device-signed local ledger and queued for sync. |
| FR-8 | Synchronisation is idempotent, bounded, retried with backoff and never deletes unacknowledged data. |
| FR-9 | The server re-verifies hashes, signatures, chain links, manifests, evidence bytes and duty windows, quarantining failures. |
| FR-10 | Locations are classified against assigned zones with PostGIS, honouring reported accuracy. |
| FR-11 | Rules raise review flags (missed/late check-ins, clock anomalies, mock indicators, integrity failures, gaps, conflicts, spatial exceptions, movement inconsistencies, device posture, screen re-capture risk). |
| FR-12 | Supervisors review flags (acknowledge, assign, resolve/dismiss with a note, reopen); all actions audited. |
| FR-13 | Evidence can be inspected and exported (verification package ZIP, manifest JSON, PDF report; patrol logs CSV) under access control and audit. |
| FR-14 | Exported packages can be verified offline by a standalone tool. |
| FR-15 | The dashboard distinguishes recently received, delayed, offline-last-known and stale observations. |
| FR-16 *(2.0)* | Personnel are classified by personnel category (Police / Home Guard), rank (PC, HC, ASI, SI, CI, DSP) and constable subtype (AR / General). |
| FR-17 *(2.0)* | Every account has a role whose permissions and data scope are stored in the database and enforced by the backend on every request. Users cannot change their own role, status or rank. |
| FR-18 *(2.0)* | Authorised users create, staff, publish, change, cancel and complete duties in four categories: Train Beat, Station Watch, VIP Escort and Track Incident. |
| FR-19 *(2.0)* | Staffing is flexible and policy-driven: configurable eligibility per category, warnings for gaps, rejection of inactive personnel, and conflict/leave detection with reasoned, audited overrides. |
| FR-20 *(2.0)* | Duty status follows a defined state machine. Every change is recorded in an append-only history with reason, actor and time. |
| FR-21 *(2.0)* | Versioned instructions, acceptance and handovers are recorded with acknowledgements. |
| FR-22 *(2.0)* | Each assigned person receives a device session, so check-ins and evidence are linked to the person and the duty, with device and server times shown separately. |
| FR-23 *(2.0)* | Exceptions cover missed/late check-ins, delayed reporting, overdue duties, sync failures, evidence failures and conflicts, with notes, resolution and audit. They are never classified as misconduct. |
| FR-24 *(2.0)* | Corrections never overwrite history: original, proposed value, reason, requester and an independent approval are stored. |
| FR-25 *(2.0)* | A duty roster (daily, weekly, monthly), a personnel directory, in-app notifications with truthful delivery status, scoped CSV/PDF reports and a protected status page are provided. |
| FR-26 *(2.0)* | Restricted categories (VIP escort, track incident) reveal sensitive details only to authorised or assigned users. |
| FR-27 *(2.0)* | Deterministic synthetic demo data and the requested demonstration accounts can be reset repeatably. Production refuses demo seeding, and demo logins only work with explicit configuration. |

## Non-functional requirements

| ID | Requirement | Realisation |
|---|---|---|
| NFR-1 Security | Standard primitives only; least privilege; secure defaults | ADR-002/003/008, `config/env.ts` production checks |
| NFR-2 Integrity | Tamper evidence for events, evidence, audit | hash chains, signatures, append-only triggers |
| NFR-3 Privacy | Data minimisation, visible collection, no covert capture | `docs/privacy-governance.md` |
| NFR-4 Reliability | Offline for ≥ 8 h without loss; crash-safe | transactional ledger, persistent outbox, idempotent ingestion |
| NFR-5 Performance | 50-event batch ≤ 2 s p95; spatial check ≤ 20 ms p95 | measured: `docs/performance.md` |
| NFR-6 Maintainability | Typed code, tests, lint, migrations, ADRs | TypeScript strict, automated suites (see results), ESLint, forward-only migrations |
| NFR-7 Accessibility | Keyboard navigation, focus states, labels, contrast, responsive | Tailwind design tokens, ARIA roles, tested layouts |
| NFR-8 Portability | Windows development, Render deployment | PowerShell scripts, `deploy/render.yaml` |
| NFR-9 Transparency | Every limitation and unverified area disclosed | this document, `docs/limitations.md` |

## Technology stack

| Layer | Choice | Version (pinned) | Reason |
|---|---|---|---|
| Mobile UI | React Native CLI + TypeScript | RN 0.87.1, React 19.2 | Native module access; no Expo Go |
| Native | Kotlin, CameraX, AndroidX Biometric, Android Keystore, LocationManager, SensorManager, AlarmManager | CameraX 1.4.2, Biometric 1.1.0 | Supported platform APIs |
| Local DB | SQLite + SQLCipher via op-sqlite | 15.2.14 | Maintained native binding with SQLCipher build flag |
| API | Node.js + Express + TypeScript | Node 22 LTS, Express 5.1, TS 5.9 | Mature, testable, Render-native |
| Database | PostgreSQL + PostGIS | 16 / 3.4 | Spatial types, indexes, constraints, triggers |
| Validation | zod | 4.6 | Shared schemas for API and device |
| Auth | Argon2id, jose (JWT), rotating refresh tokens | @node-rs/argon2 2.0, jose 6.1 | Modern password hashing, standard tokens |
| Dashboard | React + Vite + Tailwind CSS + React-Leaflet | Vite 7.1, Tailwind 3.4, RL 5.0 | Fast build, accessible UI, map |
| Testing | Vitest, Supertest, React Testing Library, JUnit 4 | Vitest 3.2 | One runner across packages |
| Tooling | pnpm workspace, ESLint, Prettier, GitHub Actions, Docker Compose | pnpm 10 | Reproducible installs (lockfiles committed) |
