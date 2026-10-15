# Changelog

## 2.0 — 2026-10-15 (railway-police operations upgrade)
Upgrade of the 1.0 code base. The 1.0 engine is retained, and the upgrade is applied by migrations
`0006`–`0007`.

### Added
* **Personnel model.** Synthetic units hierarchy plus personnel categories:
  * HG (Home Guard, outside the rank hierarchy);
  * ranks PC, HC, ASI, SI, CI and DSP;
  * AR/General as a constable classification;
  * activation/deactivation with no deletion.
* **Authorisation.** Database-backed roles, permissions and data scopes (SELF / UNIT / UNIT_TREE / ALL),
  enforced on every request. Out-of-scope records return 404. Restricted-duty details are redacted.
* **Duty assignments** for Train Beat, Station Watch, VIP Escort (restricted) and Track Incident (restricted):
  * flexible staffing; eligibility checks; overlap, unavailability and inactive-personnel warnings;
  * a validated status workflow;
  * append-only change history;
  * reassignment, replacement and cancellation with reasons;
  * versioned instructions with acknowledgements, acceptance and handovers.
* Configurable per-category check-in intervals, reporting windows and grace periods. These are used by the
  server and by the mobile check-in scheduler.
* **Duty roster** (daily, weekly, monthly); personnel duty history; unavailability records.
* **Exception management:**
  * delayed reporting, overdue, sync failure, evidence hash mismatch, conflicts and inactive personnel;
  * acknowledge/resolve with append-only notes;
  * a periodic evaluator.
* **Audited record corrections** (requester ≠ approver); in-app notifications with truthful delivery state.
* **CSV/PDF reports** (audited downloads); protected system-status page with measured values and the result of
  the last real backup drill.
* **Dashboard:** permission-driven navigation and role-specific landing pages; centralised UI strings
  (`en`, with a Telugu dictionary ready to fill).
* **Rank demonstration accounts** `*@parmaan.demo`, a deterministic generator (`--reference-date`) and
  `pnpm db:reset-demo`.
* `pnpm scenarios`: 42 end-to-end scenario checks with simulated devices.
* **Documentation:** railway operations, authorisation matrix, operational procedures, ADR-009/010, upgrade
  section in the deployment guide.

### Changed
* Ranks `CONSTABLE`, `HEAD_CONSTABLE` and `INSPECTOR` were migrated to `PC`, `HC` and `CI`.
* Web sign-in now requires the `web.login` permission, and device sign-in requires `mobile.login`.
* `ALLOW_DEMO_LOGIN` was added. Demo accounts are refused in production unless it is explicitly set.
* The local Docker database is published on host port 5433.

### Not verified in this delivery
* Android native build and on-device behaviour.
* Render deployment.
* Departmental validation of rules.
* Telugu translations (the dictionary is empty).
