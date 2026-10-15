# Authorisation design: ranks, roles, permissions and scope

> **Prototype defaults.** Everything in this chapter is configuration stored in the database
> (`roles`, `permissions`, `role_permissions`, `duty_categories`, `duty_category_eligibility`). None of it is an
> official statement of Andhra Pradesh Railway Police authority. The department must confirm each rule before
> any operational use. An administrator can change it on the **Duty policy & roles** page.

## 1. Rank, personnel category and constable subtype are separate

| Attribute | Stored in | Values | Notes |
|---|---|---|---|
| Personnel category | `officers.personnel_category` | `POLICE`, `HOME_GUARD` | Home Guards (HG) are a separate category, **not** a rank. A database constraint forbids a rank on a Home Guard record. |
| Rank | `officers.rank` | `PC`, `HC`, `ASI`, `SI`, `CI`, `DSP` (`OTHER` for legacy data) | These are only the ranks supplied for this project. No other ranks were invented, and the list is not claimed to be the complete official hierarchy. |
| Constable subtype | `officers.constable_category` | `AR` (Armed Reserve), `GENERAL`, or not recorded | Allowed only when the rank is `PC` (constraint). AR is **not** a rank above PC and gives no extra permissions. The locally used designation must be confirmed with the department. |
| Gender | `officers.gender` | `FEMALE`, `MALE`, `OTHER`, `NOT_RECORDED` (default) | Stored only when explicitly supplied (the synthetic demo data supplies it so the sample is balanced). Never used for eligibility, and never inferred from a name. |
| Unit | `officers.unit_id` → `units` | Unit tree: sub-division › circle › station | Used for data scope. |

The UI derives a display class from these attributes: `HG — Home Guard`, `PC — Armed Reserve`, `PC — General`,
`HC — Head Constable`, `ASI`, `SI`, `CI`, `DSP`. The same class is snapshotted on every duty assignment
(`duty_assignment_personnel.personnel_class`), so the history keeps what the person was at that time.

## 2. Accounts, roles and permissions

* **Personnel records and login accounts are separate.** `officers` holds the person; `app_users` holds the
  credential (an Argon2id hash only), the role and an optional link to a personnel record. A role marked
  `requires_personnel` (all rank roles) cannot exist without a linked person. This is enforced by a trigger.
* **Roles** (`roles`): `HG`, `PC`, `HC`, `ASI`, `SI`, `CI`, `DSP`, plus `ADMIN` (a prototype system
  administrator, not a police rank). The PRAMAAN 1.0 roles `SUPERVISOR`, `REVIEWER` and `OFFICER` are kept for
  backward compatibility.
* **The access token carries only the user id and the session family.** On *every* request, `requireAuth`
  re-reads the account's role, permission set, active status, the personnel record's active status and the
  data scope from the database. A role edited in the browser, or a forged role claim in a token signed with
  the real key, grants nothing. The second case is covered by an automated test.
* **Every privileged endpoint states its permissions** (`requirePermission(...)`). Navigation that the
  dashboard hides is a convenience only; the API enforces the same rules.
* **No self-escalation.** A user cannot change their own role, account status or personnel record (rank,
  subtype, unit), and an administrator cannot remove `policy.manage` or `users.manage` from their own role
  (lock-out guard). A role or status change ends the affected account's sessions immediately.

## 3. Data scope

| Scope level | Meaning | Default roles |
|---|---|---|
| `SELF` | Only the user's own personnel record and the duties they were assigned to | HG, PC, OFFICER |
| `UNIT` | Personnel of the user's own unit (station) | HC, ASI |
| `UNIT_TREE` | The user's unit and all units below it | SI (station), CI (circle), DSP (sub-division) |
| `ALL` | No unit restriction | ADMIN, SUPERVISOR, REVIEWER |

Scope is applied in SQL to every list, detail, dashboard count, report, map observation, exception, evidence item
and audit query (`apps/api/src/security/access.ts`). A record outside scope returns **404**, so the response does
not reveal that it exists. A duty assignment is visible when its owning unit is in scope, or when any person
assigned to it (now or earlier) is in scope.

### Restricted duties
VIP escort and track-incident duties are flagged `is_restricted` (configurable per category). Their sensitive
details are returned only to holders of `duty.view_restricted` and to the personnel assigned to that duty:
title, VIP/escort label, incident reference, reporting location, notes, instruction text, handover tasks and
the before/after values in the change history. Linked evidence, observations and check-ins follow the same rule.
Other users in scope still see that a duty exists and who is assigned, with “restricted details” placeholders.

## 4. Default permission matrix

Scope: HG/PC/OFFICER = SELF · HC/ASI = UNIT · SI/CI/DSP = UNIT_TREE · ADMIN/SUPERVISOR/REVIEWER = ALL.

| Permission | HG | PC | HC | ASI | SI | CI | DSP | ADMIN | SUPERVISOR | REVIEWER | OFFICER |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `audit.verify` |  |  |  |  |  |  |  | ● |  |  |  |
| `audit.view` |  |  |  |  |  | ● | ● | ● | ● |  |  |
| `availability.manage` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `checkin.perform` | ● | ● | ● | ● | ● | ● |  |  |  |  | ● |
| `checkin.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `correction.approve` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `correction.request` | ● | ● | ● | ● | ● | ● |  | ● |  |  |  |
| `dashboard.view` |  |  | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `device.approve` |  |  |  |  |  |  |  | ● |  |  |  |
| `device.view` |  |  |  |  | ● | ● | ● | ● | ● | ● |  |
| `duty.approve` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `duty.assign` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `duty.close` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `duty.create` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `duty.handover.record` |  |  | ● | ● | ● | ● |  | ● | ● |  |  |
| `duty.instructions.publish` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `duty.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `duty.view_restricted` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `evidence.export` |  |  |  |  | ● | ● |  | ● | ● | ● |  |
| `evidence.package` |  |  |  |  |  | ● |  | ● | ● |  |  |
| `evidence.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `evidence.view_image` |  |  |  |  | ● | ● |  | ● | ● |  |  |
| `exception.manage` |  |  |  | ● | ● | ● |  | ● | ● |  |  |
| `exception.view` |  |  | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `map.view` |  |  |  |  | ● | ● | ● | ● | ● | ● |  |
| `mobile.login` | ● | ● | ● | ● | ● | ● |  |  |  |  | ● |
| `personnel.manage` |  |  |  |  |  |  |  | ● |  |  |  |
| `personnel.view` |  |  | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `policy.manage` |  |  |  |  |  |  |  | ● |  |  |  |
| `reports.export` |  |  |  |  | ● | ● | ● | ● | ● |  |  |
| `reports.view` |  |  |  | ● | ● | ● | ● | ● | ● | ● |  |
| `roster.view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |
| `system.health` |  |  |  |  |  |  |  | ● |  |  |  |
| `users.manage` |  |  |  |  |  |  |  | ● |  |  |  |
| `web.login` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |  |

Reading the defaults:
* **HG, PC (AR and General):** sign in on the web and on the duty device; view only their own duties, roster,
  check-ins and evidence metadata; perform check-ins; accept duties; acknowledge instructions and handovers;
  request corrections. *PC — AR* has exactly the same permissions as *PC — General*.
* **HC:** own-unit view, exception visibility and handover recording. No assignment powers by default.
* **ASI:** HC plus managing exceptions (acknowledge, note, resolve) and report summaries. No assignment
  approval by default.
* **SI:** station-level assignment workflow (create, assign, publish, close), instructions, restricted
  details, evidence images, availability, approving corrections, exports.
* **CI:** circle-level version of SI, plus audit review and full evidence-package export.
* **DSP:** aggregated overview, reports and audit across the sub-division. **No** restricted duty details,
  evidence images or assignment powers unless explicitly granted. These are the “detailed records only where
  explicitly authorised” defaults.
* **ADMIN:** configuration, accounts, personnel records, devices, system status. It holds no field-device
  permissions.

## 5. Demonstration accounts and production safety

| Role | Login | Password |
|---|---|---|
| HG — Home Guard | `hg@parmaan.demo` | `hg-parmaan.demo` |
| PC — General Constable | `pc@parmaan.demo` | `pc-parmaan.demo` |
| PC — AR Constable | `pc.ar@parmaan.demo` | `pc.ar-parmaan.demo` |
| HC — Head Constable | `hc@parmaan.demo` | `hc-parmaan.demo` |
| ASI — Assistant Sub-Inspector | `asi@parmaan.demo` | `asi-parmaan.demo` |
| SI — Sub-Inspector | `si@parmaan.demo` | `si-parmaan.demo` |
| CI — Circle Inspector | `ci@parmaan.demo` | `ci-parmaan.demo` |
| DSP — Deputy Superintendent of Police | `dsp@parmaan.demo` | `dsp-parmaan.demo` |
| System administrator (additional, not a rank) | `admin@parmaan.demo` | `admin-parmaan.demo` |

* These are **local/test demonstration credentials only**. They follow a published pattern and do not meet
  the password policy enforced for real accounts (12+ characters, upper and lower case, a digit). The seed
  writes them directly as Argon2id hashes. They must never be used for real departmental accounts.
* The seed command refuses to run when `NODE_ENV=production` (`ALLOW_DEMO_SEED` is rejected in production).
* Accounts flagged `is_demo` **cannot sign in** when `NODE_ENV=production`, unless `ALLOW_DEMO_LOGIN=true` is
  set explicitly. The API then logs a warning at start-up and the status page shows “Demo accounts can sign in:
  yes”. Refused demo logins are audited as `DEMO_LOGIN_DISABLED`.
* The login page never displays credentials.
