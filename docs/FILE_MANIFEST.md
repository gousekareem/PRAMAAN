# Project file manifest

338 files (excluding dependencies, build outputs and secrets). SHA-256 of every file: `MANIFEST.sha256` at the archive root. Sizes of this file and of `MANIFEST.sha256` are shown as — because they change when the archive is regenerated.


## (root)

| File | Bytes |
|---|---:|
| `.editorconfig` | 225 |
| `.env.example` | 2,168 |
| `.gitattributes` | 136 |
| `.gitignore` | 524 |
| `.npmrc` | 44 |
| `.prettierignore` | 91 |
| `.prettierrc.json` | 81 |
| `CONTRIBUTING.md` | 705 |
| `LICENSE` | 1,643 |
| `MANIFEST.sha256` | — |
| `README.md` | 3,828 |
| `SECURITY.md` | 815 |
| `THIRD_PARTY_NOTICES.md` | 2,888 |
| `docker-compose.yml` | 1,516 |
| `eslint.config.mjs` | 1,346 |
| `package.json` | 1,457 |
| `pnpm-lock.yaml` | 164,814 |
| `pnpm-workspace.yaml` | 340 |
| `tsconfig.base.json` | 428 |

## .github — CI

| File | Bytes |
|---|---:|
| `.github/workflows/ci.yml` | 2,192 |

## apps/admin — Dashboard

| File | Bytes |
|---|---:|
| `apps/admin/.env.example` | 246 |
| `apps/admin/README.md` | 847 |
| `apps/admin/index.html` | 509 |
| `apps/admin/package.json` | 1,150 |
| `apps/admin/postcss.config.js` | 67 |
| `apps/admin/public/favicon.svg` | 279 |
| `apps/admin/src/app/App.tsx` | 334 |
| `apps/admin/src/app/AppRoutes.tsx` | 1,898 |
| `apps/admin/src/auth/AuthContext.tsx` | 4,061 |
| `apps/admin/src/auth/RequireAuth.tsx` | 987 |
| `apps/admin/src/components/layout/AppFooter.tsx` | 1,643 |
| `apps/admin/src/components/layout/AppLayout.tsx` | 5,054 |
| `apps/admin/src/components/ui/Badges.tsx` | 3,428 |
| `apps/admin/src/components/ui/Misc.tsx` | 6,850 |
| `apps/admin/src/components/ui/States.tsx` | 1,705 |
| `apps/admin/src/evidence/EvidenceImage.tsx` | 1,578 |
| `apps/admin/src/hooks/useApi.ts` | 815 |
| `apps/admin/src/hooks/useLiveStream.ts` | 2,411 |
| `apps/admin/src/hooks/useRefreshOnChange.ts` | 573 |
| `apps/admin/src/main.tsx` | 451 |
| `apps/admin/src/map/ObservationMap.tsx` | 3,040 |
| `apps/admin/src/pages/AlertsPage.tsx` | 10,857 |
| `apps/admin/src/pages/AuditPage.tsx` | 5,563 |
| `apps/admin/src/pages/DevicesPage.tsx` | 6,562 |
| `apps/admin/src/pages/DutiesPage.tsx` | 7,805 |
| `apps/admin/src/pages/EvidenceDetailPage.tsx` | 10,367 |
| `apps/admin/src/pages/EvidencePage.tsx` | 4,477 |
| `apps/admin/src/pages/LoginPage.tsx` | 3,582 |
| `apps/admin/src/pages/MapPage.tsx` | 7,191 |
| `apps/admin/src/pages/NotFoundPage.tsx` | 327 |
| `apps/admin/src/pages/OfficerDetailPage.tsx` | 6,417 |
| `apps/admin/src/pages/OfficersPage.tsx` | 3,300 |
| `apps/admin/src/pages/OverviewPage.tsx` | 5,886 |
| `apps/admin/src/services/api.ts` | 3,233 |
| `apps/admin/src/services/config.ts` | 413 |
| `apps/admin/src/services/types.ts` | 4,364 |
| `apps/admin/src/styles.css` | 1,583 |
| `apps/admin/src/tests/auth.test.tsx` | 1,733 |
| `apps/admin/src/tests/components.test.tsx` | 3,574 |
| `apps/admin/src/tests/footer.test.tsx` | 2,177 |
| `apps/admin/src/tests/pages.test.tsx` | 7,648 |
| `apps/admin/src/tests/setup.ts` | 193 |
| `apps/admin/src/tests/utils.tsx` | 2,239 |
| `apps/admin/tailwind.config.ts` | 631 |
| `apps/admin/tsconfig.json` | 385 |
| `apps/admin/vite.config.ts` | 453 |

## apps/api — Backend API

| File | Bytes |
|---|---:|
| `apps/api/README.md` | 1,338 |
| `apps/api/package.json` | 1,831 |
| `apps/api/src/app.ts` | 3,702 |
| `apps/api/src/bootstrap.ts` | 545 |
| `apps/api/src/config/env.ts` | 4,855 |
| `apps/api/src/context.ts` | 370 |
| `apps/api/src/database/migrate-cli.ts` | 458 |
| `apps/api/src/database/migrate.ts` | 3,171 |
| `apps/api/src/database/pool.ts` | 1,415 |
| `apps/api/src/database/seed-cli.ts` | 1,274 |
| `apps/api/src/database/seed.ts` | 5,247 |
| `apps/api/src/events/bus.ts` | 956 |
| `apps/api/src/evidence/export.ts` | 10,159 |
| `apps/api/src/evidence/screen-analysis.ts` | 945 |
| `apps/api/src/evidence/storage.ts` | 2,046 |
| `apps/api/src/evidence/upload.ts` | 9,302 |
| `apps/api/src/ingestion/derive.ts` | 17,281 |
| `apps/api/src/ingestion/ingest.ts` | 23,097 |
| `apps/api/src/logger.ts` | 511 |
| `apps/api/src/middleware/auth.ts` | 2,378 |
| `apps/api/src/middleware/errors.ts` | 2,733 |
| `apps/api/src/middleware/request-id.ts` | 569 |
| `apps/api/src/routes/audit.ts` | 3,209 |
| `apps/api/src/routes/auth.ts` | 4,667 |
| `apps/api/src/routes/common.ts` | 2,202 |
| `apps/api/src/routes/dashboard.ts` | 11,928 |
| `apps/api/src/routes/devices.ts` | 8,561 |
| `apps/api/src/routes/duties.ts` | 7,349 |
| `apps/api/src/routes/evidence.ts` | 8,925 |
| `apps/api/src/routes/health.ts` | 1,480 |
| `apps/api/src/routes/officers.ts` | 4,503 |
| `apps/api/src/routes/patrol-logs.ts` | 5,727 |
| `apps/api/src/routes/sync.ts` | 1,478 |
| `apps/api/src/routes/users.ts` | 687 |
| `apps/api/src/routes/zones.ts` | 852 |
| `apps/api/src/security/device-keys.ts` | 1,223 |
| `apps/api/src/security/passwords.ts` | 1,003 |
| `apps/api/src/security/tokens.ts` | 2,351 |
| `apps/api/src/server.ts` | 1,243 |
| `apps/api/src/services/audit.ts` | 4,460 |
| `apps/api/src/services/auth.ts` | 7,784 |
| `apps/api/src/services/flags.ts` | 2,015 |
| `apps/api/src/spatial/zones.ts` | 2,840 |
| `apps/api/src/tests/auth.test.ts` | 10,420 |
| `apps/api/src/tests/domain.test.ts` | 14,533 |
| `apps/api/src/tests/evidence.test.ts` | 10,364 |
| `apps/api/src/tests/global-setup.ts` | 1,051 |
| `apps/api/src/tests/helpers.ts` | 3,692 |
| `apps/api/src/tests/sync.test.ts` | 13,569 |
| `apps/api/src/tools/benchmark.ts` | 5,519 |
| `apps/api/src/tools/create-user.ts` | 2,938 |
| `apps/api/src/tools/sim-device.ts` | 7,477 |
| `apps/api/src/tools/simulate-device.ts` | 16,345 |
| `apps/api/src/tools/verify-audit-cli.ts` | 372 |
| `apps/api/tsconfig.build.json` | 63 |
| `apps/api/tsconfig.json` | 243 |
| `apps/api/vitest.config.ts` | 263 |

## apps/mobile — Android app (RN + Kotlin)

| File | Bytes |
|---|---:|
| `apps/mobile/.gitignore` | 1,085 |
| `apps/mobile/.watchmanconfig` | 3 |
| `apps/mobile/README.md` | 1,700 |
| `apps/mobile/android/app/build.gradle` | 3,578 |
| `apps/mobile/android/app/debug.keystore` | 2,257 |
| `apps/mobile/android/app/proguard-rules.pro` | 623 |
| `apps/mobile/android/app/src/debug/res/xml/network_security_config.xml` | 596 |
| `apps/mobile/android/app/src/main/AndroidManifest.xml` | 3,553 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/MainActivity.kt` | 1,340 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/MainApplication.kt` | 772 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/PramaanPackage.kt` | 835 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/duty/BootReceiver.kt` | 1,383 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/duty/CheckinAlarmReceiver.kt` | 2,553 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/duty/DutyMonitorService.kt` | 10,778 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/duty/DutyPrefs.kt` | 1,435 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/duty/Notifications.kt` | 3,632 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/duty/ObservationStore.kt` | 2,603 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/duty/PramaanDutyModule.kt` | 11,157 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/evidence/CaptureActivity.kt` | 5,443 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/evidence/PramaanEvidenceModule.kt` | 8,166 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/security/CryptoFormat.kt` | 3,911 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/security/DevicePosture.kt` | 2,464 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/security/KeystoreManager.kt` | 5,746 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/security/PostureRules.kt` | 1,481 |
| `apps/mobile/android/app/src/main/java/com/pramaan/mobile/security/PramaanSecurityModule.kt` | 6,993 |
| `apps/mobile/android/app/src/main/res/drawable/ic_stat_pramaan.xml` | 300 |
| `apps/mobile/android/app/src/main/res/drawable/rn_edit_text_material.xml` | 1,917 |
| `apps/mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher.png` | 3,056 |
| `apps/mobile/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png` | 5,024 |
| `apps/mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher.png` | 2,096 |
| `apps/mobile/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png` | 2,858 |
| `apps/mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png` | 4,569 |
| `apps/mobile/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png` | 7,098 |
| `apps/mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png` | 6,464 |
| `apps/mobile/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png` | 10,676 |
| `apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` | 9,250 |
| `apps/mobile/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png` | 15,523 |
| `apps/mobile/android/app/src/main/res/values/strings.xml` | 193 |
| `apps/mobile/android/app/src/main/res/values/styles.xml` | 282 |
| `apps/mobile/android/app/src/main/res/xml/backup_rules.xml` | 340 |
| `apps/mobile/android/app/src/main/res/xml/data_extraction_rules.xml` | 536 |
| `apps/mobile/android/app/src/main/res/xml/network_security_config.xml` | 333 |
| `apps/mobile/android/app/src/test/java/com/pramaan/mobile/CryptoFormatTest.kt` | 2,134 |
| `apps/mobile/android/app/src/test/java/com/pramaan/mobile/DevicePostureTest.kt` | 918 |
| `apps/mobile/android/build.gradle` | 546 |
| `apps/mobile/android/gradle.properties` | 2,153 |
| `apps/mobile/android/gradle/wrapper/gradle-wrapper.jar` | 48,966 |
| `apps/mobile/android/gradle/wrapper/gradle-wrapper.properties` | 252 |
| `apps/mobile/android/gradlew` | 8,654 |
| `apps/mobile/android/gradlew.bat` | 3,093 |
| `apps/mobile/android/settings.gradle` | 344 |
| `apps/mobile/app.json` | 58 |
| `apps/mobile/babel.config.js` | 182 |
| `apps/mobile/index.js` | 323 |
| `apps/mobile/metro.config.js` | 844 |
| `apps/mobile/package-lock.json` | 335,942 |
| `apps/mobile/package.json` | 1,762 |
| `apps/mobile/src/app/App.tsx` | 3,680 |
| `apps/mobile/src/app/ServicesContext.tsx` | 337 |
| `apps/mobile/src/checkins/checkinEngine.ts` | 14,237 |
| `apps/mobile/src/components/SyncStatusCard.tsx` | 1,768 |
| `apps/mobile/src/components/ui.tsx` | 3,923 |
| `apps/mobile/src/evidence/evidenceService.ts` | 6,962 |
| `apps/mobile/src/ledger/ledger.ts` | 9,421 |
| `apps/mobile/src/native/modules.ts` | 4,527 |
| `apps/mobile/src/navigation/types.ts` | 214 |
| `apps/mobile/src/screens/CaptureScreen.tsx` | 3,633 |
| `apps/mobile/src/screens/CheckinScreen.tsx` | 6,108 |
| `apps/mobile/src/screens/EvidenceScreen.tsx` | 1,558 |
| `apps/mobile/src/screens/HomeScreen.tsx` | 5,746 |
| `apps/mobile/src/screens/LedgerScreen.tsx` | 1,586 |
| `apps/mobile/src/screens/LoginScreen.tsx` | 2,049 |
| `apps/mobile/src/screens/RegisterScreen.tsx` | 2,048 |
| `apps/mobile/src/screens/SettingsScreen.tsx` | 4,859 |
| `apps/mobile/src/sensors/observationProcessor.ts` | 6,117 |
| `apps/mobile/src/services/config.ts` | 636 |
| `apps/mobile/src/services/container.ts` | 10,373 |
| `apps/mobile/src/services/session.ts` | 3,276 |
| `apps/mobile/src/storage/db.ts` | 1,082 |
| `apps/mobile/src/storage/migrations.ts` | 6,789 |
| `apps/mobile/src/storage/opsqlite.ts` | 1,925 |
| `apps/mobile/src/sync/backoff.ts` | 531 |
| `apps/mobile/src/sync/http.ts` | 2,962 |
| `apps/mobile/src/sync/retention.ts` | 3,473 |
| `apps/mobile/src/sync/syncEngine.ts` | 15,269 |
| `apps/mobile/src/tests/checkins.test.ts` | 8,592 |
| `apps/mobile/src/tests/evidence.test.ts` | 9,775 |
| `apps/mobile/src/tests/ledger.test.ts` | 6,436 |
| `apps/mobile/src/tests/sync.test.ts` | 13,396 |
| `apps/mobile/src/tests/testkit.ts` | 3,227 |
| `apps/mobile/src/types/platform.ts` | 1,751 |
| `apps/mobile/tsconfig.json` | 572 |
| `apps/mobile/vitest.config.mjs` | 434 |

## database — SQL migrations, seeds, schema

| File | Bytes |
|---|---:|
| `database/README.md` | 1,221 |
| `database/migrations/0001_extensions.sql` | 893 |
| `database/migrations/0002_identity_and_assets.sql` | 6,655 |
| `database/migrations/0003_ingestion.sql` | 4,557 |
| `database/migrations/0004_domain.sql` | 7,946 |
| `database/migrations/0005_audit.sql` | 2,154 |
| `database/roles.sql` | 857 |
| `database/schema.sql` | 43,098 |
| `database/seeds/0001_demo_zones.sql` | 1,432 |

## deploy — Render + Docker deployment

| File | Bytes |
|---|---:|
| `deploy/Dockerfile.admin` | 648 |
| `deploy/Dockerfile.api` | 964 |
| `deploy/deployment-notes.md` | 921 |
| `deploy/nginx-admin.conf` | 326 |
| `deploy/render.yaml` | 2,647 |

## docs — Documentation, results, screenshots, demo artefacts

| File | Bytes |
|---|---:|
| `docs/FILE_MANIFEST.md` | — |
| `docs/PRAMAAN_WINDOWS_AND_RENDER_DEPLOYMENT_GUIDE.md` | 23,255 |
| `docs/adr/ADR-001-monorepo-and-stack.md` | 1,374 |
| `docs/adr/ADR-002-canonical-json-and-hashing.md` | 1,026 |
| `docs/adr/ADR-003-device-signatures.md` | 1,389 |
| `docs/adr/ADR-004-offline-sync-and-idempotency.md` | 1,232 |
| `docs/adr/ADR-005-migrations.md` | 744 |
| `docs/adr/ADR-006-trusted-time.md` | 751 |
| `docs/adr/ADR-007-evidence-storage.md` | 936 |
| `docs/adr/ADR-008-sessions.md` | 871 |
| `docs/api-reference.md` | 7,258 |
| `docs/architecture.md` | 6,065 |
| `docs/data-flow.md` | 4,022 |
| `docs/database-design.md` | 4,684 |
| `docs/demo-run/demo-run-console.txt` | 3,232 |
| `docs/demo-run/demo-run.json` | 4,701 |
| `docs/demo-run/local-manifest-example.json` | 2,018 |
| `docs/demo-run/sample-evidence-package-TAMPERED.zip` | 32,902 |
| `docs/demo-run/sample-evidence-package.zip` | 32,896 |
| `docs/demo-run/sample-evidence-report.pdf` | 4,529 |
| `docs/demo-run/verification-report-original.json` | 3,084 |
| `docs/demo-run/verification-report-tampered.json` | 3,173 |
| `docs/demo-run/verifier-cli-original.txt` | 2,338 |
| `docs/demo-run/verifier-cli-tampered.txt` | 2,436 |
| `docs/demo-script.md` | 7,268 |
| `docs/device-test-checklist.md` | 3,218 |
| `docs/diagrams/documentation-diagram-01.svg` | 43,670 |
| `docs/diagrams/documentation-diagram-02.svg` | 32,661 |
| `docs/diagrams/documentation-diagram-03.svg` | 27,927 |
| `docs/diagrams/documentation-diagram-04.svg` | 34,455 |
| `docs/diagrams/documentation-diagram-05.svg` | 16,016 |
| `docs/limitations.md` | 4,028 |
| `docs/performance.md` | 1,560 |
| `docs/privacy-governance.md` | 3,015 |
| `docs/report/01-introduction.md` | 3,843 |
| `docs/report/02-requirements.md` | 4,355 |
| `docs/report/05-mobile.md` | 6,132 |
| `docs/report/06-backend.md` | 4,352 |
| `docs/report/14-deployment.md` | 1,701 |
| `docs/report/16-screenshots.md` | 1,261 |
| `docs/report/18-conclusion.md` | 6,645 |
| `docs/report/19-appendix.md` | 14,434 |
| `docs/requirement-traceability.md` | 9,652 |
| `docs/results/backup-restore-check.txt` | 912 |
| `docs/results/benchmark-results.json` | 820 |
| `docs/results/dependency-audit.md` | 872 |
| `docs/results/metro-android-bundle.md` | 376 |
| `docs/results/test-results-summary.md` | 1,723 |
| `docs/results/test-results.md` | 16,840 |
| `docs/screenshots/01-login.png` | 40,511 |
| `docs/screenshots/02-overview.png` | 154,065 |
| `docs/screenshots/03-map.png` | 132,658 |
| `docs/screenshots/04-alerts.png` | 370,354 |
| `docs/screenshots/05-evidence-list.png` | 111,381 |
| `docs/screenshots/06-evidence-detail.png` | 549,318 |
| `docs/screenshots/07-officer.png` | 165,247 |
| `docs/screenshots/08-devices.png` | 79,841 |
| `docs/screenshots/09-audit.png` | 319,678 |
| `docs/screenshots/10-mobile-overview-reviewer.png` | 328,295 |
| `docs/security-model.md` | 5,997 |
| `docs/testing.md` | 3,332 |
| `docs/threat-matrix.md` | 11,161 |

## packages/event-contracts — Shared packages

| File | Bytes |
|---|---:|
| `packages/event-contracts/package.json` | 684 |
| `packages/event-contracts/src/audit-chain.ts` | 2,644 |
| `packages/event-contracts/src/canonical.ts` | 4,187 |
| `packages/event-contracts/src/chain.ts` | 4,667 |
| `packages/event-contracts/src/clock.ts` | 4,958 |
| `packages/event-contracts/src/event.ts` | 4,077 |
| `packages/event-contracts/src/index.ts` | 253 |
| `packages/event-contracts/src/manifest.ts` | 5,819 |
| `packages/event-contracts/src/package-format.ts` | 1,745 |
| `packages/event-contracts/src/rules.ts` | 6,658 |
| `packages/event-contracts/src/screen-risk.ts` | 4,932 |
| `packages/event-contracts/src/tests/canonical.test.ts` | 1,958 |
| `packages/event-contracts/src/tests/chain.test.ts` | 2,892 |
| `packages/event-contracts/src/tests/clock.test.ts` | 3,323 |
| `packages/event-contracts/src/tests/helpers.ts` | 1,330 |
| `packages/event-contracts/src/tests/manifest-screen.test.ts` | 4,758 |
| `packages/event-contracts/src/tests/rules.test.ts` | 2,965 |
| `packages/event-contracts/tsconfig.json` | 225 |
| `packages/event-contracts/vitest.config.mjs` | 126 |

## packages/validation — Shared packages

| File | Bytes |
|---|---:|
| `packages/validation/package.json` | 615 |
| `packages/validation/src/index.ts` | 11,362 |
| `packages/validation/src/tests/validation.test.ts` | 2,702 |
| `packages/validation/tsconfig.json` | 225 |
| `packages/validation/vitest.config.mjs` | 126 |

## packages/verifier — Shared packages

| File | Bytes |
|---|---:|
| `packages/verifier/package.json` | 635 |
| `packages/verifier/src/build.ts` | 1,801 |
| `packages/verifier/src/cli.ts` | 1,370 |
| `packages/verifier/src/index.ts` | 51 |
| `packages/verifier/src/tests/verify.test.ts` | 7,827 |
| `packages/verifier/src/verify.ts` | 9,159 |
| `packages/verifier/tsconfig.json` | 244 |
| `packages/verifier/vitest.config.mjs` | 126 |

## scripts — Setup/test/package/backup scripts

| File | Bytes |
|---|---:|
| `scripts/backup-restore-check.sh` | 2,573 |
| `scripts/check-health.ps1` | 712 |
| `scripts/package-project.ps1` | 1,893 |
| `scripts/package-project.sh` | 1,302 |
| `scripts/run-kotlin-jvm-tests.sh` | 1,429 |
| `scripts/run-tests.ps1` | 2,101 |
| `scripts/run-tests.sh` | 1,681 |
| `scripts/setup-windows.ps1` | 1,720 |
| `scripts/summarize-test-results.mjs` | 3,016 |
| `scripts/verify-environment.ps1` | 1,384 |

## tools — Documentation build tools

| File | Bytes |
|---|---:|
| `tools/docs/build_pdf.py` | 11,028 |
| `tools/docs/capture_screenshots.py` | 3,509 |
| `tools/docs/package-lock.json` | 48,502 |
| `tools/docs/package.json` | 209 |
