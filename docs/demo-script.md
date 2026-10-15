# Demonstration script and viva preparation

All data is **synthetic** (DEMO personnel with plausible Telugu-region names, fictional units, illustrative
zones near Guntur, synthetic train/VIP/incident references). Steps marked *(simulated)* use the simulated
device tools; steps marked *(device)* require a physical Android phone.

## Preparation (2 minutes before the demo)
```powershell
pnpm db:reset-demo                      # drop + migrate + seed synthetic data (never on real data)
pnpm dev:api                            # terminal 1
pnpm dev:admin                          # terminal 2 → http://localhost:5173
pnpm scenarios                          # terminal 3: 42 scenario checks over HTTP (simulated devices)
```

## Five-minute end-to-end demonstration (PRAMAAN 2.0)

| Time | Account | Action | What to point out |
|---|---|---|---|
| 0:00 | `dsp@parmaan.demo` | Overview | Every figure is a count of stored records within the DSP's sub-division; personnel by rank and subtype (HG separate; PC — AR / PC — General); duties by category with completion; exceptions by type |
| 0:40 | DSP | VIP escorts → the escort | Duty visible, details **restricted**; DSP has no image access by default ("detailed records only where authorised") |
| 1:00 | `si@parmaan.demo` | Duty assignments → **New duty** (Train beat) → pick two AR constables → publish | No fixed AR/General combination; publish notifies personnel; assigning an already-engaged constable gives **409 conflict** → override with reason → exception raised |
| 1:50 | SI | Open the SCENARIO train beat | Personnel table: device-reported start (device clock) vs server receipt; check-ins on time/missed; versioned instructions with acknowledgements; append-only history with reasons |
| 2:30 | SI | Duty roster → weekly / monthly | Category colours, leave (hatched), conflicts (red outline), inactive personnel marked |
| 3:00 | `asi@parmaan.demo` | Exceptions → missed check-in → acknowledge → add investigation note | Never classified as misconduct; notes append-only; actions audited |
| 3:30 | `pc.ar@parmaan.demo` | My duties → accept VIP escort; acknowledge instructions; request a correction | PC-AR has exactly PC permissions; corrections keep the original |
| 4:00 | SI | Corrections → approve; Evidence verification → failed (tampered) item; Reports → export completion PDF | Requester ≠ approver; tampered bytes quarantined and linked to the duty; export audited with SHA-256 |
| 4:30 | `admin@parmaan.demo` | System status; Duty policy & roles; Audit history → verify | Measured health; backup shown only with a drill result; configurable prototype defaults; chain intact |

## Demonstration workflow per rank

| Rank / account | Lands on | Demonstrate | Must NOT be able to |
|---|---|---|---|
| **HG** `hg@parmaan.demo` | My duties | own station watch, instructions acknowledgement, handovers, own check-ins and evidence status, own sync status | see personnel directory, other people's duties, exceptions, reports, accounts (403) |
| **PC — General** `pc@parmaan.demo` | My duties | own duties (station watch with handover as outgoing person), check-ins, correction request | same restrictions as HG |
| **PC — AR** `pc.ar@parmaan.demo` | My duties | same as PC; AR shown as classification only; accept the VIP escort | anything beyond PC permissions |
| **HC** `hc@parmaan.demo` | Overview (station scope) | station personnel and duty status, exceptions (view), record a handover | create/assign duties, manage exceptions, see restricted evidence (404) |
| **ASI** `asi@parmaan.demo` | Overview | exception management (acknowledge, notes, resolve), report summaries | assign/approve duties, see restricted details |
| **SI** `si@parmaan.demo` | Overview | full station workflow: create, assign, publish, instructions, handovers, close, approve corrections, unavailability, exports | see Narasaraopet (other circle) records (404); manage accounts or policy |
| **CI** `ci@parmaan.demo` | Overview (circle) | circle-wide duties incl. Tenali, conflicts, audit history, evidence package export | see Narasaraopet circle (404) |
| **DSP** `dsp@parmaan.demo` | Overview (sub-division) | aggregated overview, reports, audit across both circles | restricted duty details, evidence images, assignment actions (by default) |
| **Admin** `admin@parmaan.demo` | Overview | accounts, roles & policy, personnel create/deactivate, devices, system status | change own role/status (403) |

## Scenario-based tests (repeatable)
`pnpm scenarios` runs 42 HTTP checks against the seeded API and writes `scenarios-run.json`
(copy in `docs/demo-run/`): four categories; train beat with check-ins and a missed check-in; station watch
with offline synchronisation, replay and duplicates; overlapping assignment with refused HC override and
reasoned SI override; inactive personnel; VIP restriction; incident evidence verification and tampering;
unauthorised access; exception evaluation, review and resolution; audited correction; invalid transition;
report exports; audit-chain verification.

## PRAMAAN 1.0 five-minute demo (still available)

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

### PRAMAAN 2.0 viva questions

**Why is AR not a rank?** The supplied hierarchy is HG, PC, HC, ASI, SI, CI and DSP. AR (Armed Reserve) and
General describe a constable's classification, so they are stored as a PC attribute. Making AR a rank above PC
would invent a hierarchy and would grant AR constables extra powers, which the source did not describe.

**Why are permissions stored in the database rather than derived from rank?** A higher rank does not
automatically mean every action is allowed, and the department may decide differently from the prototype's
defaults. Explicit role → permission sets with data scopes make least privilege visible, configurable and
testable. Because they are re-read on every request, a change takes effect immediately and a tampered token
gains nothing.

**How do you prevent fixed staffing assumptions?** Eligibility is a configurable list per category,
ineligibility can block or only warn, and staffing gaps produce warnings rather than rejections. Tests create
AR+AR, General+General, HG-only, mixed and single-person duties.

**Does an assigned or completed duty prove attendance?** No. Assignment is a plan and completion is a
supervisor's record. The strongest signal PRAMAAN offers is a set of device-signed events (start, check-ins
with biometric and code, location with accuracy, in-app evidence), and even those are corroboration, not proof.

**What stops someone from quietly fixing an attendance record?** Originals are never updated. A correction is
a separate record holding the server-read original value, a reason and an approval by a different person.
Decided corrections are immutable, and every step is in the hash-linked audit log.

**How is VIP and incident information protected?** Restricted categories show details only to assigned
personnel and holders of `duty.view_restricted`. The redaction applies to lists, details, history, reports,
evidence and observations, and the demo uses only synthetic labels and non-graphic images.
