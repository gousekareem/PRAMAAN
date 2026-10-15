# PRAMAAN — Cryptographic Proof-of-Presence Engine

*Academic capstone prototype (B.Tech final year): railway-police duty assignment, presence verification,
evidence integrity and supervisory monitoring. The intended user context is railway police in Andhra Pradesh
(Guntur).*

> **Not an official system.** PRAMAAN has not been commissioned, approved, certified or deployed by Guntur
> Railway Police, the Andhra Pradesh Railway Police or any government authority. All bundled data is
> synthetic. Operational rules are configurable prototype defaults that the department must validate.

**PRAMAAN 2.0** adds a railway-police operations layer to the 1.0 proof-of-presence engine:
* **Personnel and hierarchy:** HG (Home Guard, a separate category), PC (with AR/General as a classification,
  not a rank), HC, ASI, SI, CI and DSP.
* **Authorisation:** database-backed roles and permissions with data scopes (own, unit, unit tree, all),
  enforced by the backend.
* **Four duty categories:** Train Beat, Station Watch, VIP Escort (restricted) and Track Incident (restricted),
  with flexible, configurable staffing, conflict and leave detection, versioned instructions, acceptance,
  handovers, a duty roster, exception management, audited corrections, in-app notifications, CSV/PDF reports
  and a protected system-status page.

The 1.0 engine is unchanged underneath:
* **On the phone:** duty evidence is recorded **offline-first** (randomised biometric + cognitive check-ins,
  in-app camera, location/steps/transit, clock behaviour) as **device-signed, hash-linked events**.
* **On the server:** these synchronise idempotently to an API that re-verifies every hash, signature and
  evidence byte, classifies locations with PostGIS and raises exceptions for human review.

Nothing claims that an assignment, a hash, a GPS fix, a photo or a biometric prompt proves physical presence.

## Repository
```
apps/api        Express 5 + PostgreSQL/PostGIS backend (auth/RBAC, duties, ingestion, verification, reports, audit)
apps/admin      React + Vite + Tailwind + Leaflet dashboard (permission-based navigation; i18n-ready strings)
apps/mobile     React Native CLI app (TypeScript) + Kotlin native modules (android/)
packages/       event-contracts (canonical JSON, hashing, chain, clock, rules) · validation · verifier (CLI)
database/       SQL migrations 0001–0007, seeds, schema snapshot
deploy/         Render blueprint, Dockerfiles, nginx config
scripts/        Windows PowerShell + bash setup/test/package/backup scripts
docs/           operations workflow, authorisation, architecture, security, threat matrix, API, testing,
                results, procedures, screenshots, ADRs, deployment guide
```

## Quick start (Windows, PowerShell, from the repository root)
```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1   # deps, .env, DB (Docker), migrations, demo seed
pnpm dev:api                                                          # http://localhost:4000
pnpm dev:admin                                                        # http://localhost:5173
pnpm scenarios                                                        # 42 scenario checks (simulated devices)
pnpm db:reset-demo                                                    # reset the synthetic demo data at any time
powershell -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1      # all automated checks
```
Full instructions: [`docs/PRAMAAN_WINDOWS_AND_RENDER_DEPLOYMENT_GUIDE.md`](docs/PRAMAAN_WINDOWS_AND_RENDER_DEPLOYMENT_GUIDE.md).

## Demonstration accounts (local / test environments only)

| Role | Login | Password |
|---|---|---|
| HG — Home Guard | `hg@parmaan.demo` | `hg-parmaan.demo` |
| PC — General Constable | `pc@parmaan.demo` | `pc-parmaan.demo` |
| PC — AR Constable | `pc.ar@parmaan.demo` | `pc.ar-parmaan.demo` |
| HC — Head Constable | `hc@parmaan.demo` | `hc-parmaan.demo` |
| ASI — Assistant Sub-Inspector | `asi@parmaan.demo` | `asi-parmaan.demo` |
| SI — Sub-Inspector | `si@parmaan.demo` | `si-parmaan.demo` |
| CI — Circle Inspector | `ci@parmaan.demo` | `ci-parmaan.demo` |
| DSP — Deputy Superintendent of Police | `dsp@parmaan.demo` | `dsp-parmaan.demo` |
| System administrator *(additional; not a rank)* | `admin@parmaan.demo` | `admin-parmaan.demo` |

* Never use these passwords for real accounts.
* Seeding is refused when `NODE_ENV=production`, and demo accounts cannot sign in there unless
  `ALLOW_DEMO_LOGIN=true` is set explicitly.
* The PRAMAAN 1.0 demo accounts (`admin|supervisor|reviewer|officer1|officer2@pramaan.demo`, password =
  `SEED_DEMO_PASSWORD`) are kept for the original simulated-device demo (`pnpm simulate`).

## Status at delivery (honest boundary)
| Area | Status |
|---|---|
| Backend (auth/RBAC, duties, ingestion, verification, reports) + PostGIS | Verified by 100 API integration tests, 42/42 scenario checks with **simulated** devices, a schema upgrade test and a real upgrade of a 1.0 database |
| Dashboard, shared packages, mobile business logic, Kotlin pure-JVM logic | Verified by automated tests. See `docs/results/test-results.md` |
| Kotlin native modules and Android UI (incl. new duty-assignment UI) | Implemented, **not compiled or run** here (no Android SDK); Metro bundle built |
| Physical Android behaviour, SQLCipher at runtime | **Not verified.** See `docs/device-test-checklist.md` |
| Render deployment | Configuration provided, **not deployed** |
| Departmental validation of rules | **Not done.** All operational rules are configurable prototype defaults |

See [`docs/railway-operations.md`](docs/railway-operations.md), [`docs/authorization.md`](docs/authorization.md),
[`docs/requirement-traceability.md`](docs/requirement-traceability.md) and [`docs/limitations.md`](docs/limitations.md).

## Developer
**SHAIK GOUSE KAREEM** — [LinkedIn](https://www.linkedin.com/in/gousekareem/)

© 2026 SHAIK GOUSE KAREEM. All Rights Reserved. Proprietary academic project. See [`LICENSE`](LICENSE).
Third-party components remain under their own licences ([`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)).
