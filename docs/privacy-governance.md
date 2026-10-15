# Privacy, governance and operational safeguards

PRAMAAN is designed as **transparent duty accountability**, not covert surveillance.

| Safeguard | Implementation |
|---|---|
| Visible collection | Location/step collection runs only inside a foreground service with a persistent "PRAMAAN duty session active" notification, started by the officer for an authorised duty session, stopped at duty end (+30 min grace) or by the officer. |
| No background location | `ACCESS_BACKGROUND_LOCATION` is not requested. |
| No covert capture | No microphone permission; camera is used only in the visible in-app capture screen; `FLAG_SECURE` prevents screenshots of evidence and codes. |
| No biometric templates | Android performs matching inside secure hardware; PRAMAAN stores only success/failure and a Keystore signature. |
| No face recognition | Not implemented, by design. |
| Data minimisation | Locations persisted at most every 5 min or 150 m; steps as milestones; accelerometer only as 3-s samples per minute producing state *changes*; pseudonymous officer references. |
| Least privilege | Database-backed role → permission sets with data scopes (SELF/UNIT/UNIT_TREE/ALL); higher rank does not automatically grant every action (e.g. DSP has no image access by default); field personnel see only their own records; restricted VIP-escort and track-incident details only for `duty.view_restricted` or assigned personnel; see `authorization.md`. |
| Access auditing | Evidence metadata/content views, every export (package, manifest, PDF, CSV), flag actions, device actions, logins and audit verification are recorded in the hash-linked audit log. |
| Human review | Every rule outcome is a *review flag* with its inputs and innocent explanations; resolving requires a note; original observations cannot be modified. |
| Retention | `retention_policies` (default: locations 180 d, evidence images 730 d, audit 7 y, rejected submissions 365 d). Device-side compaction only after server acknowledgement + verification + age. |
| Deletion | Normal UIs cannot delete. Server deletion of append-only data requires an explicit, audited purge transaction that sets `pramaan.retention_purge = on` (procedure below). Deletion from the live database does not remove copies in backups; backups expire by their own retention schedule. |
| Synthetic data | All seeded personnel, units, accounts, zones, duties, VIP labels and incident references are synthetic and labelled `DEMO` / `is_demo`; the seed refuses to run in production and demo accounts cannot sign in in production unless `ALLOW_DEMO_LOGIN=true` is set explicitly. No real personnel records (including information from the ASP conversation) are included. |
| Gender | Stored only when explicitly supplied; never inferred and never used for duty eligibility. |
| Personnel records | Never deleted (trigger); deactivation preserves duty, check-in and evidence history. |

## Retention purge procedure (administrator, outside the application)
1. Export and independently store the current audit checkpoint.
2. In one transaction: `SET LOCAL pramaan.retention_purge = 'on';` delete rows older than the policy that
   are not referenced by open flags; insert an audit record describing the purge (counts, cut-off).
3. Re-run `pnpm db:verify-audit`; record the new checkpoint.
Automated purging is intentionally not implemented in the prototype.

## Before any real-world use
Legal basis and notice to officers, data-protection impact assessment, union/staff consultation, policy on
use of flags in disciplinary matters (flags must never be the sole basis), independent security testing,
and organisational approval.

Operational procedures (account revocation, lost device, backup restoration, suspected tampering, evidence
retention): [`operational-procedures.md`](operational-procedures.md).
