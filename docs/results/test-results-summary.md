# Test execution results

Generated: 2026-10-13T06:36:22.666Z · Node v22.22.0 · linux

| Suite | Passed | Failed | Skipped | Describe blocks |
|---|---:|---:|---:|---:|
| Shared contracts (canonical JSON, hashing, chain, clock, rules, screen-risk) | 35 | 0 | 0 | 12 |
| Validation schemas | 5 | 0 | 0 | 2 |
| Independent evidence-package verifier | 8 | 0 | 0 | 2 |
| Backend API + PostgreSQL/PostGIS integration | 52 | 0 | 0 | 17 |
| Admin dashboard (React Testing Library) | 28 | 0 | 0 | 13 |
| Mobile business logic (ledger, sync, check-ins, evidence) | 39 | 0 | 0 | 11 |
| Kotlin pure-JVM unit tests (CryptoFormat, PostureRules) | 7 | 0 | 0 | 2 |
| **Total** | **174** | **0** | **0** | |

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

The per-test listing (174 named tests) is in `docs/results/test-results.md` inside the project archive. Other recorded runs: end-to-end simulation (`docs/demo-run/`), Metro Android release bundle (`docs/results/metro-android-bundle.md`), backup/restore drill (`docs/results/backup-restore-check.txt`), dependency audit (`docs/results/dependency-audit.md`), benchmarks (`docs/performance.md`).
