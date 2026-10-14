# Demonstration script and viva preparation

All data is **synthetic** (DEMO officers, fictional zones near Guntur). Steps marked *(simulated)* use the
simulated device (`pnpm simulate`); steps marked *(device)* require a physical Android phone.

## Five-minute capstone demo

| Time | Action | What to point out |
|---|---|---|
| 0:00 | Dashboard Overview as `supervisor@pramaan.demo` | Counts are from synchronised records; footer attribution; "DEMO" labels |
| 0:30 | Run `pnpm simulate -- --password <pw>` in a terminal *(simulated)* | Registration refused until approval; offline batch of 11 events; duplicate batch replayed; tampered payload and forged hash rejected; corrupted image quarantined |
| 1:45 | Alerts page | Flags explain innocent causes; acknowledge → assign → resolve (note required); audit records |
| 2:30 | Map | "Recently received / Delayed synchronization" labels, accuracy circles, inside/outside zone result |
| 3:00 | Evidence detail | Declared vs server-computed SHA-256, separate device/estimated/server times, ledger neighbours, custody |
| 3:40 | Export verification package; run `node packages/verifier/dist/cli.js <zip>` | PASS with 17 checks, works without the server |
| 4:10 | Flip one bit (`docs/demo-run/sample-evidence-package-TAMPERED.zip`) and verify again | FAIL: `file.evidence/original.jpg`, `image.sha256` |
| 4:40 | Audit history → Run full verification | Chain intact; checkpoint to record externally |

## Full end-to-end workflow (20 steps)

1. Register a demonstration device — app *(device)* or simulator step 03 *(simulated)*.
2. Log in as `officer1@pramaan.demo` on the device.
3. Start the duty session (`DUTY_SESSION_STARTED`; duty notification appears *(device)*).
4. Record a check-in (scheduled 90–150 min randomly; for demos use a test build with a shorter policy).
5. Complete BiometricPrompt *(device only)*.
6. Type the 3-digit code within 5 s.
7. Capture evidence through the in-app camera *(device)*.
8. Inspect the manifest/hash on the result card (or `docs/demo-run/local-manifest-example.json`).
9. Enable airplane mode.
10. Generate offline events (patrol, capture, missed check-in).
11. Force-stop and reopen the app *(device)* — sequence continues; restart recorded.
12. Disable airplane mode.
13. Queued events synchronise (Home → "Sync now").
14. Verify the server response (Synced status, server-acknowledged head).
15. Dashboard → Map / Officer page shows the observations with freshness labels.
16. Inspect a spatial-zone check (Patrol logs or map detail: inside / boundary / outside).
17. Submit a deliberately corrupted payload (simulator step 15).
18. Observe rejection/quarantine (`EVENT_HASH_MISMATCH`, `EVIDENCE_HASH_MISMATCH`).
19. Re-upload a duplicate batch (simulator steps 12–13).
20. Confirm no duplicate records (`replayed=true`, `DUPLICATE` statuses; counts unchanged).

**Demo reset:** `pnpm db:seed -- --reset` (development only; drops and recreates all PRAMAAN tables).
**Offline fallback demo:** if no network/projector access to Render, run everything locally
(`docker compose up -d db`, `pnpm dev:api`, `pnpm dev:admin`) and use the recorded artefacts in
`docs/demo-run/` and the real screenshots in `docs/screenshots/`.

## Checklist for evaluators
- [ ] `/ready` shows PostGIS and 5 migrations
- [ ] Test summary shows 0 failures (`docs/results/test-results.md`)
- [ ] Device approval required before sync
- [ ] Duplicate batch does not create duplicates
- [ ] Corrupted evidence quarantined
- [ ] Package verifier PASS → tamper → FAIL
- [ ] Map never says "live"
- [ ] Footer shows © 2026 SHAIK GOUSE KAREEM and LinkedIn link on every page

## Viva questions and answers

**Why is GPS alone insufficient?** A phone reports coordinates it computes; mock providers, rooted
devices and GNSS spoofers can falsify them, and accuracy degrades on platforms, in yards and trains.
PRAMAAN therefore stores accuracy and the mock indicator and correlates location with steps, transit
speed, check-ins and camera evidence — and still only raises review flags.

**Why does a hash not prove a scene is genuine?** SHA-256 proves that bytes are identical to what was
hashed. Whoever controls the phone can photograph a screen or inject an image and hash it. Hashes give
integrity (no change since capture); authenticity of the depicted scene needs independent corroboration.

**Why can an offline phone not know authoritative NTP time?** NTP needs network access. The wall clock is
user-adjustable. PRAMAAN uses the monotonic `elapsedRealtime` clock since the last server-time anchor; the
estimate has growing uncertainty and is invalid after a reboot.

**Why do hash chains need trusted anchors?** Without a reference, an attacker who controls the data can
recompute the whole chain. The server's acknowledged head (and the externally recorded audit checkpoint)
is the anchor that makes later rewriting detectable — demonstrated by the "full rewrite" test.

**Why are Android foreground services not unkillable?** The OS can stop any app (memory pressure,
force-stop, OEM power managers, permission revocation). Apps can only request priority and restart; PRAMAAN
records interruptions instead of claiming continuity.

**Why may cell tower information be unavailable?** `getAllCellInfo` needs fine-location permission; many
devices return partial or redacted values (`Integer.MAX_VALUE`), none in airplane mode or for some radios;
and a cell covers a large area. PRAMAAN marks missing values as missing.

**Why does biometric authentication not guarantee continuous identity?** It confirms a match at one moment
against any biometric enrolled on the phone; after that the phone can be handed over. Biometrics also never
leave the phone, so the server sees only a success result and a Keystore signature.

**Why is screen-photo detection probabilistic?** Moiré is aliasing between two grids; it depends on
distance, focus, resolution and compression. Fabrics and tiles create the same spectral peaks (false
positives); high-PPI screens slightly out of focus create none (false negatives).

**Why does offline synchronisation need idempotency?** A request can succeed on the server while the
response is lost; the phone must retry. Without a fixed `batchId` and unique event IDs the retry would
duplicate records or, worse, be treated as conflicting evidence.

**Why is PostGIS useful?** It provides correct geodesic distance and containment on `geography` types with
spatial indexes, versioned polygons and SQL that can be audited — instead of hand-written geometry code.

**Why does the system need human review?** Every signal has innocent explanations and can be spoofed;
combining them reduces but never removes uncertainty. Decisions affecting people must be made by
accountable humans who see the inputs and record their reasoning — which the alert workflow enforces.

**What is new compared with GPS-only tracking?** Offline-first signed, hash-linked event ledger;
server-anchored trusted-time estimates; device-key–bound evidence manifests verified server-side and
independently; multi-signal correlation with explicit suppression rules; and an audited review workflow.
These are engineering contributions; no field evaluation was performed.
