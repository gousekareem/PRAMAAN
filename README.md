# PRAMAAN — Cryptographic Proof-of-Presence Engine

*Academic capstone prototype (B.Tech final year) for duty accountability in a railway-police context
(Guntur Railway Police, Andhra Pradesh, as the intended user organisation).*

> **Not an official system.** PRAMAAN has not been commissioned, approved, certified or deployed by Guntur
> Railway Police or any government authority. All bundled data is synthetic.

PRAMAAN records duty evidence on an Android phone **offline-first** — randomised check-ins with a biometric
gate and attention challenge, controlled in-app camera captures, location/step/transit observations and
clock behaviour — as **device-signed, hash-linked events** in an encrypted ledger. When connectivity returns
the events synchronise idempotently to an API that re-verifies every hash, signature and evidence byte,
classifies locations with **PostGIS**, and raises **review flags** for supervisors. Nothing in the system
claims that a hash, a GPS fix, a photo or a biometric prompt proves physical presence; it combines
independent observations and leaves decisions to accountable humans.

## Repository
```
apps/api        Express 5 + PostgreSQL/PostGIS backend (ingestion, verification, exports, SSE, audit chain)
apps/admin      React + Vite + Tailwind + Leaflet supervisory dashboard
apps/mobile     React Native CLI app (TypeScript) + Kotlin native modules (android/)
packages/       event-contracts (canonical JSON, hashing, chain, clock, rules) · validation · verifier (CLI)
database/       SQL migrations, demo seeds, schema snapshot
deploy/         Render blueprint, Dockerfiles, nginx config
scripts/        Windows PowerShell + bash setup/test/package/backup scripts
docs/           architecture, security, threat matrix, API, testing, results, screenshots, ADRs, guide
```

## Quick start (Windows, PowerShell, from the repository root)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1   # deps, .env, DB (Docker), migrations, demo seed
pnpm dev:api                                                          # http://localhost:4000
pnpm dev:admin                                                        # http://localhost:5173  (supervisor@pramaan.demo)
pnpm simulate -- --password Demo-Only-Passw0rd                        # simulated device end-to-end demo
powershell -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1      # all automated checks
```
Full instructions: [`docs/PRAMAAN_WINDOWS_AND_RENDER_DEPLOYMENT_GUIDE.md`](docs/PRAMAAN_WINDOWS_AND_RENDER_DEPLOYMENT_GUIDE.md).

## Status at delivery (honest boundary)
| Area | Status |
|---|---|
| Shared contracts, verifier, API + PostGIS, dashboard, mobile business logic | Implemented and verified by 174 automated tests (0 failures) plus a recorded end-to-end run with a **simulated** device |
| Kotlin native modules (Keystore, BiometricPrompt, CameraX, foreground service, alarms, sensors) | Implemented, **not compiled/run** here (no Android SDK); pure-JVM parts unit-tested |
| Physical Android behaviour, SQLCipher at runtime | **Not verified** — see `docs/device-test-checklist.md` |
| Render deployment | Configuration provided, **not deployed** |

See `docs/requirement-traceability.md` and `docs/limitations.md`.

## Demo accounts (local development only)
`admin@pramaan.demo`, `supervisor@pramaan.demo`, `reviewer@pramaan.demo`, `officer1@pramaan.demo`,
`officer2@pramaan.demo` — password = `SEED_DEMO_PASSWORD` in your `.env`. Seeding is refused in production.

## Developer
**SHAIK GOUSE KAREEM** — [LinkedIn](https://www.linkedin.com/in/gousekareem/)

© 2026 SHAIK GOUSE KAREEM. All Rights Reserved. Proprietary academic project — see [`LICENSE`](LICENSE).
Third-party components remain under their own licences ([`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)).
