# Introduction

## Project overview
**PRAMAAN** (Sanskrit/Telugu/Hindi: *proof, evidence*) is a cryptographic proof-of-presence engine designed
as a B.Tech final-year capstone around the operational context of the **Guntur Railway Police (GRP)**,
Andhra Pradesh. It is an academic prototype: it has not been commissioned, endorsed or deployed by GRP or
any government body, and all data shipped with it is synthetic.

The system consists of an Android duty application (React Native + Kotlin), a Node.js/PostgreSQL/PostGIS
backend, a React dashboard and an independent evidence-package verifier.

**Version 2.0** extends the prototype with operational information obtained from an Assistant Superintendent
of Police:
* the railway-police hierarchy (HG, PC with AR/General classification, HC, ASI, SI, CI, DSP);
* rank-based accounts with backend-enforced permissions and data scopes;
* four principal duty categories (Train Beat, Station Watch, VIP Escort, Track Incident) with flexible,
  configurable staffing;
* rosters, handovers, versioned instructions, exception management, audited corrections, notifications,
  reports and a protected system-status page.

These are built on the unchanged 1.0 presence-verification engine. All demonstration data is synthetic, and every
operational rule is a configurable default awaiting departmental validation.

## Problem statement
Patrol accountability commonly relies on manual beat books, verbal reports, periodic photographs and
GPS-only tracking. In railway environments these mechanisms are weak:
- connectivity disappears for hours on express trains and in yards, so "live" tracking silently stops;
- photographs can be re-used, re-photographed from screens, or forwarded from galleries;
- device clocks and GPS positions can be manipulated by the user;
- a single missed report or out-of-zone point is easily over-interpreted as misconduct, while genuine
  gaps are easily explained away — there is no tamper-evident record of what was observed when.

## Objectives
1. Record duty evidence **offline-first** so that nothing depends on connectivity at the moment of
   observation.
2. Make every record **tamper-evident**: canonical serialisation, SHA-256 hash chaining and signatures by
   a non-exportable device key, re-verified on the server and by an independent verifier.
3. Collect **independent observations** — randomised biometric-gated check-ins with an attention
   challenge, in-app camera evidence, location with accuracy, step counts, transit speed, clock behaviour
   and device posture — rather than relying on any single signal.
4. Synchronise **idempotently** after hours offline, preserving the chronology of device time, anchored
   time estimates and server receipt time.
5. Validate locations against patrol zones with **PostGIS** while honouring GPS accuracy.
6. Give supervisors a **review workflow** that explains each flag, its inputs and innocent explanations,
   and audits every action — never automated conclusions.
7. Be honest about limits: document residual risks and what was and was not verified.
8. *(2.0)* Model the supplied rank hierarchy and personnel classification correctly (HG is outside the rank
   ladder; AR is a constable classification) and enforce least-privilege permissions and data scopes on the
   server.
9. *(2.0)* Support the four duty categories with flexible staffing, conflict and leave detection, and
   history-preserving changes, without treating an assignment as proof of attendance.
10. *(2.0)* Give each rank a coherent, permission-appropriate dashboard backed only by stored data, with
    exportable, audited reports.

## Existing approaches and their limitations vs. the proposed system

| Aspect | Beat book / phone photos / GPS tracker | PRAMAAN |
|---|---|---|
| Offline operation | Gaps or no record | Full local recording in an encrypted ledger, delayed sync |
| Tamper evidence | None (editable files, EXIF) | Hash-linked, device-signed events; server anchors; audit chain |
| Photo provenance | Gallery uploads possible | In-app capture only; image hash bound into a signed manifest; server re-hash |
| Time | Device clock trusted | Device, anchored-estimate and server times kept separate; anomalies recorded |
| Location | Point shown as "live" | Accuracy-aware PostGIS checks; freshness labels; mock indicators |
| Identity at check-in | None | BIOMETRIC_STRONG with Keystore-attested signature + attention code |
| Interpretation | Ad hoc | Review flags with inputs and innocent explanations; audited resolution |
| Verification by third parties | Not possible | Exported package verifiable offline (PASS / FAIL / INCOMPLETE) |

## Scope of this document
Chapter 2 gives the requirements. Chapters 3–5 cover the railway-police workflow, the authorisation design and
the operational procedures. Then come architecture, data flow, mobile, backend, database and API design;
security, threats and governance; testing, results and performance; deployment, demonstration and screenshots;
traceability; and finally limitations, future work and the conclusion. Commands for setup and deployment are
in the separate *Windows and Render Deployment Guide*.

**Developer:** SHAIK GOUSE KAREEM · https://www.linkedin.com/in/gousekareem/
