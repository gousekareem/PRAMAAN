# Testing strategy

| Layer | Tooling | Location | Runs where |
|---|---|---|---|
| Shared crypto/contract logic | Vitest | `packages/*/src/tests` | any Node 22 |
| API + PostgreSQL/PostGIS integration | Vitest + Supertest against a real PostGIS database (fresh `pramaan_test` per run) | `apps/api/src/tests` | needs PostGIS (Docker Compose or local) |
| Dashboard components/pages | Vitest + React Testing Library + jsdom (react-leaflet mocked) | `apps/admin/src/tests` | any Node 22 |
| Mobile business logic | Vitest over the **same SQL migrations** on SQLite (better-sqlite3); fake clock, signer, HTTP | `apps/mobile/src/tests` | any Node 22 |
| Kotlin logic (no Android APIs) | JUnit 4 on a plain JVM | `apps/mobile/android/app/src/test` | `scripts/run-kotlin-jvm-tests.sh` or `gradlew testDebugUnitTest` |
| Android build + device behaviour | Gradle + manual checklist | `docs/device-test-checklist.md` | Android SDK + physical device (**not run here**) |
| End-to-end (simulated device) | `apps/api/src/tools/simulate-device.ts` over HTTP | `docs/demo-run/` | running API |
| Static checks | ESLint (typescript-eslint), `tsc --strict`, Prettier | root | any |
| Dependencies | `pnpm audit --prod`, `npm audit` | `docs/results/dependency-audit.md` | network |

## Commands
```powershell
docker compose up -d db                       # from repository root
powershell -ExecutionPolicy Bypass -File .\scripts\run-tests.ps1   # everything + out\test-results\SUMMARY.md
pnpm test                                     # workspace suites only
cd apps\mobile; npx vitest run                # mobile logic
```

## Coverage of required scenarios (selection)
- **Integrity/adversarial:** modified payload, forged hash, wrong-key signature, broken links, sequence
  gaps and late fill, conflicting duplicates, sequence reuse, modified/corrupted/oversize/non-JPEG
  evidence, storage tampering after verification, modified exported packages, modified custody
  records, audit chain rewrite by a superuser, append-only enforcement (UPDATE/DELETE/TRUNCATE).
- **Reliability:** replayed batches, lost responses, idempotency-key reuse, server failure mid-batch
  (whole-batch rollback then identical retry succeeds), network timeouts, captive portals, 5xx,
  expired sessions, app restart mid-sync, interrupted uploads, ledger rollback on failed companion writes.
- **Time:** rollback, forward jump, reboot, anchored estimate over 8 h, future timestamps, monotonic
  check-in deadlines that cannot be extended by changing the wall clock.
- **Check-ins:** CSPRNG uniformity, 5-s expiry, duplicate scheduling prevention across restarts, quiet
  periods, duty-end bound, biometric cancellation, missed and late acknowledgments kept separate.
- **Spatial:** inside / within accuracy / outside, lon-lat order, zone validity at observation time.
- **Access control:** unauthenticated access, roles, object-level authorisation, lockout, rate limiting,
  refresh rotation and reuse detection, logout revocation, CORS, security headers.
- **Dashboard:** route guards, role visibility, loading/empty/error states, freshness labels (never
  "live"), verification display, alert acknowledgment with confirmation, note requirement, pagination,
  footer text/link/attributes on every route.

Actual results of the final run: `docs/results/test-results.md`.
