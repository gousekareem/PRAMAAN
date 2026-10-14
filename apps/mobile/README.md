# PRAMAAN mobile (Android)

React Native 0.87 (CLI, no Expo) + TypeScript; native Kotlin modules in
`android/app/src/main/java/com/pramaan/mobile/`. Installed with **npm** (`npm ci`), not pnpm.

| Path | Purpose |
|---|---|
| `src/ledger/ledger.ts` | append-only, hash-linked, device-signed event ledger (one SQLCipher transaction per event) |
| `src/storage/` | SQLCipher adapter (refuses plaintext), local migrations |
| `src/sync/` | store-and-forward sync engine, HTTP client (captive-portal aware), backoff, retention |
| `src/checkins/` | randomised check-in scheduler, 3-digit challenge, missed/late logic |
| `src/evidence/` | capture → seal → manifest → signed event pipeline |
| `src/sensors/` | conversion of native observations into minimised events, transit detection |
| `src/native/modules.ts` | typed bridges to `PramaanSecurity`, `PramaanEvidence`, `PramaanDuty` |
| `src/screens/` | Login, Home (duty + sync status), Register, Check-in, Capture, Evidence, Ledger, Settings |
| `android/.../security/` | Keystore keys, ECDSA signing, BiometricPrompt + CryptoObject, AES-GCM container, posture checks |
| `android/.../evidence/` | CameraX capture activity (unexported), sealing, thumbnails for screen-risk |
| `android/.../duty/` | foreground service (location, steps, motion), encrypted observation buffer, alarms, boot receiver |

Commands: `npx vitest run` (logic tests), `npx tsc --noEmit`, `npx react-native run-android`,
`cd android; .\gradlew.bat assembleDebug | testDebugUnitTest`.

**Verification status:** JS logic tested; Metro release bundle built; Kotlin not compiled against the
Android SDK in the authoring environment — follow `docs/device-test-checklist.md`.
