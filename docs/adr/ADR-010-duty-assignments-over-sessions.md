# ADR-010 — Duty assignments layered over per-person duty sessions

**Status:** Accepted (PRAMAAN 2.0)

## Context
The 1.0 `duty_sessions` table represents one officer's authorised window, which device events reference. The
2.0 duty categories need one operational duty with several people, plus staffing changes, instructions,
handovers and a status life cycle. All of this must happen without breaking device synchronisation or the
evidence pipeline.

## Decision
* Add `duty_assignments` (the operation) and `duty_assignment_personnel` (the people). When a duty is
  published, each person gets an ordinary `duty_sessions` row, linked 1:1 from the personnel row.
* Device events keep referencing `dutySessionId`. Ingestion is unchanged, except that a
  `DUTY_SESSION_STARTED` also moves the assignment to `IN_PROGRESS`, with an explicit “not proof of
  attendance” reason.
* Removing or replacing a person cancels only a session that never started. Drafts never reach devices.
* All changes are written to an append-only change table plus the audit chain. Assignments, personnel rows
  and personnel records cannot be deleted.

## Consequences
* Existing check-in, evidence, spatial and exception logic applies to every category without duplication.
* Reports and exceptions join through the session to reach the assignment.
* A person's schedule lives in two places (the assignment and each session). Planned sessions are updated
  together with the assignment. Active sessions are left for the device to end.
