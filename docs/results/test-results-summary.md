# Test execution results

Generated: 2026-10-15T12:43:12.616Z · Node v22.22.0 · linux

| Suite | Passed | Failed | Skipped | Describe blocks |
|---|---:|---:|---:|---:|
| Shared contracts (canonical JSON, hashing, chain, clock, rules, screen-risk) | 35 | 0 | 0 | 12 |
| Validation schemas | 5 | 0 | 0 | 2 |
| Independent evidence-package verifier | 8 | 0 | 0 | 2 |
| Backend API + PostgreSQL/PostGIS integration | 100 | 0 | 0 | 32 |
| Admin dashboard (React Testing Library) | 46 | 0 | 0 | 21 |
| Mobile business logic (ledger, sync, check-ins, evidence) | 41 | 0 | 0 | 12 |
| Kotlin pure-JVM unit tests (CryptoFormat, PostureRules) | 7 | 0 | 0 | 2 |
| **Total** | **242** | **0** | **0** | |

## Quality gates

| Gate | Result |
|---|---|
| lint | pass (exit 0) |
| typecheck-api | pass (exit 0) |
| typecheck-admin | pass (exit 0) |
| typecheck-mobile | pass (exit 0) |
| build-api | pass (exit 0) |
| build-admin | pass (exit 0) |

## Not executed in this environment

- Android Gradle build (`assembleDebug`/`assembleRelease`) and Android-framework unit/instrumented tests: Android SDK and Google/Maven repositories unavailable.
- Behaviour on physical Android hardware (biometric prompt, CameraX capture, Keystore/StrongBox, foreground service, alarms, sensors, SQLCipher at runtime).
- Render deployment (no credentials).

Additional checks run for the 2.0 upgrade:
* `pnpm scenarios`: 42/42 scenario checks passed, with simulated devices (`docs/demo-run/scenarios-run.json`).
* Schema-upgrade test: the 0001–0005 schema was upgraded to 0007 with data preserved.
* A real upgrade of a populated 1.0 demo database, followed by `db:verify-audit` (ok).
* Backup/restore drill passed (`docs/results/backup-restore-check.txt`).
* Baseline before the upgrade: 174/174 (`docs/results/baseline-before-upgrade.md`).

The per-test listing (242 named tests) is in `docs/results/test-results.md` inside the project archive.

Other recorded runs:
* end-to-end simulation (`docs/demo-run/`);
* Metro Android release bundle (`docs/results/metro-android-bundle.md`);
* dependency audit (`docs/results/dependency-audit.md`);
* benchmarks (`docs/performance.md`).
