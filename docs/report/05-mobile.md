# Mobile architecture

## Layers
1. **React Native screens** (`src/screens`) — Login, Home (duty, next check-in, sync status), Register,
   Check-in, Capture, Evidence, Ledger, Settings.
2. **Services** (`src/services/container.ts`) — composition root: opens the SQLCipher database with a
   Keystore-wrapped key, wires ledger, sync, check-ins, evidence and observation processing; periodic
   `tick()` drains native observations, evaluates deadlines, schedules check-ins, synchronises, compacts.
3. **Domain logic** (TypeScript, unit-tested on the real schema) — `LedgerService`, `SyncEngine`,
   `CheckinEngine`, `EvidenceService`, `ObservationProcessor`, retention.
4. **Native modules** (Kotlin) — `PramaanSecurity` (clock, keys, signing, DB key, BiometricPrompt,
   posture), `PramaanEvidence` (CameraX capture, sealing, thumbnails, upload decryption),
   `PramaanDuty` (foreground service, location, steps, cell info, alarms, battery/exact-alarm settings).

## Proof-of-life engine
- **Scheduling.** `interval = secureRandomInt(90 min, 150 min)` using rejection sampling over 32-bit
  CSPRNG output, then moved out of authorised quiet periods; skipped if the deadline would fall after the
  planned duty end. The schedule row and the `CHECKIN_SCHEDULED` event are written in one transaction; a
  unique partial index allows only one outstanding check-in per duty, so repeated worker runs or restarts
  cannot create duplicates (they re-arm the same alarm).
- **Alarm execution.** `AlarmManager.setExactAndAllowWhileIdle` when exact alarms are permitted (Android
  12+: user grant), otherwise `setAndAllowWhileIdle` (inexact). Two alarms with fixed request codes —
  trigger (high-priority notification / full-screen intent when allowed) and deadline ("window passed").
  `BootReceiver` re-arms after reboot. WorkManager was not used: check-ins are time-critical and the
  visible foreground service plus AlarmManager are the supported mechanisms for that.
- **Acknowledgment.** `CHECKIN_PRESENTED` → BiometricPrompt with a `CryptoObject` (auth-per-use Keystore
  key signs a random nonce) → `BIOMETRIC_SUCCESS` (signature recorded) → a 3-digit code shown and typed
  within 5 s measured on the **monotonic** clock → `COGNITIVE_CHALLENGE_SUCCESS` → `CHECKIN_ACKNOWLEDGED`.
  Failures, cancellations and timeouts are recorded and the officer may retry until the deadline.
- **Missed check-ins.** `evaluateDeadlines()` runs on every tick and start-up; it marks a check-in missed
  when either the wall-clock deadline or (same boot) the monotonic deadline has passed, with reason
  `NO_RESPONSE`, `APP_NOT_RUNNING` or `DEVICE_REBOOTED`. A later response becomes
  `CHECKIN_ACKNOWLEDGED_LATE` referencing the missed event.
- **What it proves.** The challenge is an attention check: it shows that someone read and typed a code.
  The biometric shows a match against an enrolled biometric at that moment. Neither proves continuous
  identity or alertness.

## Background execution
The duty foreground service (`foregroundServiceType="location"`, persistent notification) requests
location updates every 60 s / 10 m from GPS and network providers, registers the step counter with a
60-s batching latency, samples the accelerometer for 3 s each minute to detect motion-state changes,
heartbeats every 60 s and stops at planned end + 30 min. It returns `START_STICKY`; after an unclean exit
the next start records `SERVICE_LIFECYCLE UNEXPECTED_TERMINATION_DETECTED/RESTARTED` with the heartbeat
gap. Observations are appended to an AES-GCM-encrypted line buffer and drained by JavaScript in two phases
(peek → persist as ledger events → remove), so a crash causes re-delivery, never loss.

**Platform constraints (documented, not hidden):** Android 8 background limits; Android 12 restrictions
on starting foreground services from the background and on exact alarms; Android 13 notification
permission; Android 14 mandatory foreground-service types/permissions and restricted full-screen intents;
OEM battery managers; force-stop disables alarms until the app is opened again; permission revocation
stops collection. The app shows exact-alarm and battery-optimisation state and links to the settings.

## Camera security
`CaptureActivity` is not exported; it uses CameraX `ImageCapture` (maximise-quality, JPEG 92) writing to
the app's private cache. Low light: the CameraX **NIGHT** extension when the vendor provides it, otherwise
automatic flash. There is no gallery, document picker or share target anywhere in the app, and the
manifest field `captureProvenance` is constrained to `IN_APP_CAMERA` by the server schema. `FLAG_SECURE`
blocks screenshots. The captured file is immediately sealed (SHA-256 + AES-256-GCM) and the plaintext
deleted. **Limit:** on a rooted device the camera pipeline itself can be hooked; this reduces, not
eliminates, injection risk.

## Anti-spoofing strategy (multi-signal, review-oriented)
| Signal | Use | Weakness |
|---|---|---|
| Mock-location flag | MEDIUM review flag | client-reported, hidden by root tools |
| Steps vs distance/zones/time | `MOVEMENT_EVIDENCE_INCONSISTENCY` | vehicles, trains, lifts, wheelchairs, sensor limits — rule suppressed when transit suspected, sensor interrupted, reboot or counter reset |
| Transit speed (> ~60 km/h, 2 reliable fixes) | suppresses walking heuristics | GPS speed can be wrong; a train can run without GPS |
| Clock behaviour | rollback/jump/divergence events | reboot removes the anchor |
| Device posture | root/emulator/debugger/signature indicators | bypassable |
| Screen re-capture score | experimental INFO flag | false positives and negatives |
| Device signature + approval | binds events to an approved key | a compromised device can still sign |

## Encrypted local storage
SQLCipher is opened with a random 256-bit key (`x'…'` raw key) that is stored only in AES-GCM-wrapped
form; the wrapping key lives in Android Keystore. `PRAGMA cipher_version` must return a version or the
app refuses to start — there is **no plaintext fallback**. Backups and device-transfer extraction are
disabled for all app data.

## Duty assignments on the device (PRAMAAN 2.0)
* `GET /api/v1/duties` returns each published per-person session with its `assignment` context: category,
  reference, restricted-aware title and details, reporting location, the latest instruction version (and
  whether this person acknowledged it), acceptance state, and the category's **check-in policy**. Drafts and
  sessions of removed or replaced personnel are not delivered.
* The context is cached in the local `duty_sessions.assignment_json` column (local migration 2), so it remains
  available offline.
* `policyForDutyRow` / `policyFromServer` (`checkins/checkinEngine.ts`) convert the category policy into the
  engine policy. The random interval and response window come from the duty category (for example VIP escort
  45–90 min / 120 s). Invalid values fall back to the default. The 5-second cognitive challenge stays fixed.
  Unit tests cover the mapping and the scheduling window.
* The Home screen shows category, reference, reporting location, train/escort/incident references,
  instructions with an **Acknowledge** button, an **Accept assignment** button when required, and **Start
  duty**. Accept and acknowledge are online actions. Errors such as being offline or not authorised are shown,
  never swallowed.
* Every field rank whose role holds `mobile.login` (HG, PC, HC, ASI, SI, CI by default) can sign in on a
  registered duty device. DSP and the administrator cannot.
* This UI is type-checked and included in the Metro bundle but, like the rest of the Android app, it **was not
  run on a device** in this delivery.
