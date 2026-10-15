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

### PRAMAAN 2.0 suites (railway-police operations)
| Suite | File | What it proves |
|---|---|---|
| Accounts & authorisation | `apps/api/src/tests/rbac.test.ts` (20) | all 9 demo accounts log in with the documented passwords; exact login convention; Argon2id-only storage; invalid credentials; PC-AR = PC permissions and AR stored as attribute; HG outside the rank hierarchy; mobile vs web client rules; logout; session list/revoke; production demo-login guard; HG blocked from admin endpoints; forged role claim grants nothing; no self role/status/rank change; role change ends sessions; inactive personnel cannot authenticate; personnel cannot be deleted; HC/SI/CI/DSP scope boundaries; 404 for out-of-scope; SELF scope; restricted VIP details; scoped reports |
| Duty management | `apps/api/src/tests/duties.test.ts` (20) | all four categories created/viewed; AR+AR, General+General, HG-only and mixed teams; category-specific fields; single-person duty with warnings; overlap detection + reasoned override + flag + roster conflict; leave conflict; inactive personnel rejected; configurable BLOCK/WARN eligibility; invalid transitions; unauthorised modifications; replacement/schedule change with history, reason and append-only enforcement; audit chain intact after changes; versioned instructions + acknowledgement; acceptance → ACCEPTED; handover acknowledgement; truthful notification delivery; reporting-delay/overdue evaluator idempotent; investigation notes; corrections never overwrite and need another approver; CSV/PDF for every report audited; dashboard counts equal DB counts; protected status page; per-category policy reaches the device duty list; drafts hidden from devices |
| Presence & evidence | `apps/api/src/tests/presence.test.ts` (7) | device start → IN_PROGRESS with device vs server time and “not proof” reason; check-ins linked to person and duty; own-only visibility; offline events, replay and duplicates; restricted incident evidence hidden from HC/ASI/DSP, image denied to HG/PC; tampered evidence fails and links the exception to the duty; personal summary |
| Upgrade path | `apps/api/src/tests/migration-upgrade.test.ts` (1) | 1.0 schema + data → 0006/0007: ranks mapped, records intact, audit chain valid, legacy logins and permissions work, re-run applies nothing |
| Dashboard | `apps/admin/src/tests/operations.test.tsx` (7) + updated `auth`, `pages`, `footer` tests | permission-driven navigation (HG vs ADMIN), page guards, restricted placeholders, duty detail actions, roster conflicts, “not proof” disclaimers, export visibility, accept action, backup “not available”; footer on 16 routes |
| Mobile | `apps/mobile/src/tests/checkins.test.ts` (+2) | server category policy mapping and scheduling within the category window |
| Scenario run | `apps/api/src/tools/scenarios.ts` (`pnpm scenarios`) | 42 checks over HTTP covering all four categories, offline sync, missed check-ins, overlapping assignments, unauthorised access, evidence tampering, supervisory review, corrections, reports; log in `docs/demo-run/scenarios-run.json` |

Actual results of the final run: `docs/results/test-results.md`.
