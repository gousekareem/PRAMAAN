# ADR-009 — Database-backed permissions and data scopes instead of fixed roles

**Status:** Accepted (PRAMAAN 2.0)

## Context
PRAMAAN 1.0 had four hard-coded roles (`ADMIN`, `SUPERVISOR`, `REVIEWER`, `OFFICER`) checked with
`requireRole(...)`. The 2.0 brief needs separate accounts for HG, PC (AR and General), HC, ASI, SI, CI and DSP.
It also requires least privilege, no automatic “higher rank can do everything”, scope boundaries, and
configurability, because the departmental rules are not yet known.

## Decision
* Store `roles`, `permissions` and `role_permissions` in the database. Each role has a `scope_level`:
  SELF, UNIT, UNIT_TREE or ALL.
* Keep the access token minimal (user id, session family). Re-read role, permissions, scope, and account and
  personnel status on **every** request.
* Replace `requireRole` with `requirePermission` / `requireAnyPermission`. Apply scope in SQL with shared
  helpers that return 404 for out-of-scope objects. Apply restricted-duty rules through a separate SQL filter.
* Keep AR/General as a personnel attribute. It confers no permissions.
* Keep the 1.0 roles with equivalent permission sets for backward compatibility.

## Consequences
* There is one extra query per request. It is acceptable at prototype scale and could be cached later with
  short-lived invalidation.
* Permission changes take effect immediately. A tampered or stale token cannot widen access.
* Every list query must include a scope predicate. This is enforced by convention and covered by tests
  (scope boundaries, restricted details, scoped reports).
