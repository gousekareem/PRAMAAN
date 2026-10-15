# ADR-008 — Authentication and session handling

**Status:** Accepted

- Passwords: Argon2id (`@node-rs/argon2`, m = 19 MiB, t = 2, p = 1); account lock after 5 failures for 15 min;
  timing equalisation for unknown accounts.
- Access tokens: HS256 JWT, 15 min, held **only in memory** in the dashboard and mobile app.
- Refresh tokens: 256-bit random, stored server-side only as SHA-256, rotated on every use; reuse of a
  rotated token revokes the whole token family. Dashboard: httpOnly cookie scoped to `/api/v1/auth`
  plus a mandatory custom header (CSRF defence). Mobile: stored inside the SQLCipher database.
- Every request re-checks that the user is active and the session family not revoked, so logout and
  device revocation take effect immediately.
- Roles: ADMIN, SUPERVISOR (DSP/SHO-style), REVIEWER (read-only, no image content), OFFICER (mobile only). **Superseded in 2.0 by ADR-009** (database-backed permissions and scopes; rank roles HG…DSP).
- 2.0: every request also re-reads the role, permissions, scope and the linked personnel record’s active status; demo accounts are refused in production unless `ALLOW_DEMO_LOGIN=true`.
