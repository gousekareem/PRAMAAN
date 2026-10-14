# Physical Android device test checklist

None of these items was executed in the authoring environment. Record results (pass/fail, device model,
Android version, date, tester) in a copy of this table.

| # | Procedure | Expected result |
|---|---|---|
| 1 | `cd apps/mobile/android; .\gradlew assembleDebug` then `adb install app\build\outputs\apk\debug\app-debug.apk` | Build succeeds; app installs |
| 2 | First launch | "Opening encrypted ledger…" then sign-in; if SQLCipher is missing the app shows "Cannot start securely" and stores nothing |
| 3 | `adb shell run-as com.pramaan.mobile ls databases` then pull `pramaan.db` and run `sqlite3 pramaan.db .tables` | `file is not a database` (encrypted) |
| 4 | Sign in as officer1, Register device | Fingerprint shown; status PENDING; dashboard shows device |
| 5 | Admin approves in dashboard Devices | Device ACTIVE on next sync |
| 6 | Settings → request permissions; allow exact alarms | Permissions granted; exact alarms "Yes" |
| 7 | Start duty | Persistent duty notification visible; `DUTY_SESSION_STARTED`, `DEVICE_INTEGRITY_OBSERVED` in local ledger |
| 8 | Walk 200 m outdoors | `LOCATION_OBSERVED` and `STEP_MILESTONE` events after the next drain (≤ 60 s) |
| 9 | Wait for check-in (or temporarily set `DEFAULT_POLICY.minIntervalMs` for a test build) | High-priority notification / full-screen intent at the scheduled time |
| 10 | Respond: biometric then code within 5 s | BIOMETRIC_SUCCESS (with Keystore signature), COGNITIVE_CHALLENGE_SUCCESS, CHECKIN_ACKNOWLEDGED |
| 11 | Cancel the biometric prompt | BIOMETRIC_FAILURE `ERROR_USER_CANCELED`, check-in still outstanding |
| 12 | Ignore a check-in for > 3 min | "Check-in window passed" notification; CHECKIN_MISSED on next open; respond → CHECKIN_ACKNOWLEDGED_LATE |
| 13 | Capture evidence in daylight and in a dark room (toggle low-light) | Manifest shown with SHA-256; NIGHT extension used where the vendor provides it |
| 14 | Confirm there is no way to choose an existing photo | No gallery/picker anywhere |
| 15 | Enable airplane mode for ≥ 30 min, keep patrolling and capture evidence | Status "Offline — recording locally"; queue counts grow |
| 16 | Force-stop the app from Settings, reopen | `SERVICE_LIFECYCLE` restart/termination evidence; queue intact; sequence continues |
| 17 | Reboot during duty | Resume notification; `BOOT_RECOVERY` + `DEVICE_REBOOTED` anomaly; alarm re-armed |
| 18 | Change the system clock back 1 h while offline | `CLOCK_ANOMALY_DETECTED` (rollback/divergence) |
| 19 | Enable a mock-location app (developer options) | `LOCATION_MOCK_INDICATOR`, MEDIUM flag after sync |
| 20 | Disable airplane mode | Batches sync, evidence uploads VERIFIED; dashboard shows "Delayed synchronization" |
| 21 | Train journey (or vehicle > 60 km/h with good GPS) | `TRANSIT_STATE_SUSPECTED ENTERED/EXITED` |
| 22 | Revoke location permission during duty | `SENSOR_PERMISSION_REVOKED` |
| 23 | Admin revokes the device | Sync fails with "Device registration has been revoked" |
| 24 | Test on a device with an aggressive OEM battery manager | Record observed alarm delays/kills |
| 25 | `.\gradlew testDebugUnitTest` | CryptoFormatTest and DevicePostureTest pass |
