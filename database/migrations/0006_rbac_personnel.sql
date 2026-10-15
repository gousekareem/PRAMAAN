-- PRAMAAN migration 0006: organisational units, personnel classification, and an explicit,
-- database-backed role/permission model.
--
-- Upgrade-safe: existing officers, accounts, duty sessions, evidence and audit records are kept.
-- Legacy rank values are mapped as follows (documented in docs/database-design.md):
--   CONSTABLE -> PC (constable category left unspecified), HEAD_CONSTABLE -> HC,
--   INSPECTOR -> CI, ASI/SI/DSP unchanged, OTHER unchanged.
-- Role/permission defaults below are PROTOTYPE DEFAULTS. They are configuration, not official
-- Andhra Pradesh Railway Police authority, and must be validated by the department.

-- ---------------------------------------------------------------------------------------------
-- Organisational units (synthetic in the demo). Units form a tree, e.g. sub-division > circle > station.
CREATE TABLE units (
  id           uuid PRIMARY KEY,
  code         text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,32}$'),
  name         text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  unit_type    text NOT NULL CHECK (unit_type IN ('SUBDIVISION','CIRCLE','STATION','OTHER')),
  parent_id    uuid REFERENCES units(id),
  geo_zone_id  uuid REFERENCES geo_zones(id),        -- optional illustrative zone for spatial checks
  is_active    boolean NOT NULL DEFAULT true,
  is_demo      boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX units_parent_idx ON units (parent_id);

-- ---------------------------------------------------------------------------------------------
-- Personnel classification. Rank and constable category are separate attributes; Home Guards are a
-- separate personnel category and are never placed in the police rank hierarchy.
ALTER TABLE officers DROP CONSTRAINT IF EXISTS officers_rank_check;
ALTER TABLE officers ALTER COLUMN rank DROP NOT NULL;
UPDATE officers SET rank = CASE rank
    WHEN 'CONSTABLE' THEN 'PC'
    WHEN 'HEAD_CONSTABLE' THEN 'HC'
    WHEN 'INSPECTOR' THEN 'CI'
    ELSE rank END;
ALTER TABLE officers
  ADD COLUMN personnel_category  text NOT NULL DEFAULT 'POLICE' CHECK (personnel_category IN ('POLICE','HOME_GUARD')),
  ADD COLUMN constable_category  text CHECK (constable_category IN ('AR','GENERAL')),
  ADD COLUMN gender              text NOT NULL DEFAULT 'NOT_RECORDED' CHECK (gender IN ('FEMALE','MALE','OTHER','NOT_RECORDED')),
  ADD COLUMN unit_id             uuid REFERENCES units(id),
  ADD CONSTRAINT officers_rank_values CHECK (rank IS NULL OR rank IN ('PC','HC','ASI','SI','CI','DSP','OTHER')),
  ADD CONSTRAINT officers_category_rank CHECK (
        (personnel_category = 'HOME_GUARD' AND rank IS NULL)
     OR (personnel_category = 'POLICE' AND rank IS NOT NULL)),
  ADD CONSTRAINT officers_constable_category CHECK (constable_category IS NULL OR rank = 'PC');
CREATE INDEX officers_unit_idx ON officers (unit_id);

-- Personnel records are never deleted (history, duties and evidence reference them). Deactivate instead.
CREATE OR REPLACE FUNCTION pramaan_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Rows of % cannot be deleted; deactivate them instead', TG_TABLE_NAME USING ERRCODE = 'P0001';
END $$;
CREATE TRIGGER officers_no_delete BEFORE DELETE ON officers FOR EACH ROW EXECUTE FUNCTION pramaan_no_delete();
CREATE TRIGGER app_users_no_delete BEFORE DELETE ON app_users FOR EACH ROW EXECUTE FUNCTION pramaan_no_delete();

-- ---------------------------------------------------------------------------------------------
-- Roles and permissions (normalised). The access token carries only the user id; permissions and
-- scope are re-read from these tables on every request, so editing a role in the browser grants nothing.
CREATE TABLE roles (
  code               text PRIMARY KEY CHECK (code ~ '^[A-Z_]{2,32}$'),
  label              text NOT NULL,
  description        text NOT NULL,
  scope_level        text NOT NULL CHECK (scope_level IN ('SELF','UNIT','UNIT_TREE','ALL')),
  requires_personnel boolean NOT NULL,          -- account must be linked to a personnel record
  is_rank_role       boolean NOT NULL DEFAULT false,
  sort_order         integer NOT NULL DEFAULT 100
);

CREATE TABLE permissions (
  code         text PRIMARY KEY CHECK (code ~ '^[a-z_]+(\.[a-z_]+)+$'),
  description  text NOT NULL
);

CREATE TABLE role_permissions (
  role_code        text NOT NULL REFERENCES roles(code),
  permission_code  text NOT NULL REFERENCES permissions(code),
  PRIMARY KEY (role_code, permission_code)
);

INSERT INTO roles (code, label, description, scope_level, requires_personnel, is_rank_role, sort_order) VALUES
  ('HG',  'HG — Home Guard',                      'Home Guard personnel account (prototype default: own records only).', 'SELF', true, true, 10),
  ('PC',  'PC — Police Constable',                'Police Constable account; AR/General is a personnel attribute and grants no extra permissions.', 'SELF', true, true, 20),
  ('HC',  'HC — Head Constable',                  'Head Constable: own unit view and exception visibility (prototype default).', 'UNIT', true, true, 30),
  ('ASI', 'ASI — Assistant Sub-Inspector',        'Assistant Sub-Inspector: unit review of duties, exceptions and evidence results (prototype default).', 'UNIT', true, true, 40),
  ('SI',  'SI — Sub-Inspector',                   'Sub-Inspector: unit duty assignment and supervision (prototype default).', 'UNIT_TREE', true, true, 50),
  ('CI',  'CI — Circle Inspector',                'Circle Inspector: circle-level supervision, reports and audit review (prototype default).', 'UNIT_TREE', true, true, 60),
  ('DSP', 'DSP — Deputy Superintendent of Police','DSP: aggregated overview and reports across the configured scope (prototype default).', 'UNIT_TREE', true, true, 70),
  ('ADMIN','System administrator',                'Prototype system administrator (configuration, accounts, devices). Not a police rank.', 'ALL', false, false, 90),
  ('SUPERVISOR','Supervisor (legacy prototype role)', 'Role from PRAMAAN 1.0, kept for backward compatibility.', 'ALL', false, false, 91),
  ('REVIEWER','Read-only reviewer (legacy prototype role)', 'Role from PRAMAAN 1.0, kept for backward compatibility.', 'ALL', false, false, 92),
  ('OFFICER','Officer (legacy prototype role)',   'Mobile-only officer role from PRAMAAN 1.0, kept for backward compatibility.', 'SELF', true, false, 93);

INSERT INTO permissions (code, description) VALUES
  ('web.login',                'Sign in to the web dashboard'),
  ('mobile.login',             'Sign in to the Android duty application'),
  ('dashboard.view',           'Operational overview within scope'),
  ('map.view',                 'Last-known observation map within scope'),
  ('personnel.view',           'View personnel directory within scope'),
  ('personnel.manage',         'Create, edit, activate and deactivate personnel records'),
  ('availability.manage',      'Record and cancel personnel unavailability periods'),
  ('users.manage',             'Create login accounts, change roles, activate/deactivate accounts'),
  ('policy.manage',            'Edit duty-category policy, eligibility and role permissions'),
  ('system.health',            'View the protected system status page'),
  ('duty.view',                'View duty assignments within scope'),
  ('duty.view_restricted',     'View restricted details of VIP escort and track-incident duties'),
  ('duty.create',              'Create draft duty assignments'),
  ('duty.assign',              'Add, remove or replace personnel and change schedules'),
  ('duty.approve',             'Publish assignments and approve conflicting assignments'),
  ('duty.close',               'Complete, cancel or mark exceptions on duty assignments'),
  ('duty.instructions.publish','Publish versioned duty instructions'),
  ('duty.handover.record',     'Record duty handovers for other personnel'),
  ('roster.view',              'View the duty roster within scope'),
  ('checkin.perform',          'Perform duty check-ins and capture evidence from a registered device'),
  ('checkin.view',             'View check-in and presence records within scope'),
  ('evidence.view',            'View evidence metadata and verification results within scope'),
  ('evidence.view_image',      'View evidence image bytes (re-verified and audited on every read)'),
  ('evidence.export',          'Export evidence manifest JSON and PDF reports'),
  ('evidence.package',         'Export the full evidence package ZIP'),
  ('exception.view',           'View exceptions (review flags) within scope'),
  ('exception.manage',         'Acknowledge, annotate, assign, resolve and dismiss exceptions'),
  ('reports.view',             'View report summaries within scope'),
  ('reports.export',           'Export CSV/PDF reports (audited)'),
  ('audit.view',               'View audit history within scope'),
  ('audit.verify',             'Run full audit-chain verification'),
  ('device.view',              'View registered devices within scope'),
  ('device.approve',           'Approve and revoke device registrations'),
  ('correction.request',       'Request an audited correction of a historical record'),
  ('correction.approve',       'Approve or reject correction requests');

-- Prototype default permission sets (least privilege; configurable through the Settings page/API).
INSERT INTO role_permissions (role_code, permission_code)
SELECT r, p FROM (VALUES
  -- Field personnel: own records only (scope SELF).
  ('HG','web.login'),('HG','mobile.login'),('HG','duty.view'),('HG','roster.view'),('HG','checkin.perform'),
  ('HG','checkin.view'),('HG','evidence.view'),('HG','correction.request'),
  ('PC','web.login'),('PC','mobile.login'),('PC','duty.view'),('PC','roster.view'),('PC','checkin.perform'),
  ('PC','checkin.view'),('PC','evidence.view'),('PC','correction.request'),
  -- Legacy mobile-only officer role (no web login, as in PRAMAAN 1.0).
  ('OFFICER','mobile.login'),('OFFICER','duty.view'),('OFFICER','checkin.perform'),('OFFICER','checkin.view'),
  ('OFFICER','evidence.view'),
  -- HC: own unit.
  ('HC','web.login'),('HC','mobile.login'),('HC','dashboard.view'),('HC','duty.view'),('HC','roster.view'),
  ('HC','checkin.perform'),('HC','checkin.view'),('HC','evidence.view'),('HC','personnel.view'),
  ('HC','exception.view'),('HC','duty.handover.record'),('HC','correction.request'),
  -- ASI: own unit, exception handling and reports.
  ('ASI','web.login'),('ASI','mobile.login'),('ASI','dashboard.view'),('ASI','duty.view'),('ASI','roster.view'),
  ('ASI','checkin.perform'),('ASI','checkin.view'),('ASI','evidence.view'),('ASI','personnel.view'),
  ('ASI','exception.view'),('ASI','exception.manage'),('ASI','duty.handover.record'),('ASI','reports.view'),
  ('ASI','correction.request'),
  -- SI: unit duty assignment and supervision.
  ('SI','web.login'),('SI','mobile.login'),('SI','dashboard.view'),('SI','map.view'),('SI','duty.view'),
  ('SI','duty.view_restricted'),('SI','duty.create'),('SI','duty.assign'),('SI','duty.approve'),('SI','duty.close'),
  ('SI','duty.instructions.publish'),('SI','duty.handover.record'),('SI','roster.view'),('SI','checkin.perform'),
  ('SI','checkin.view'),('SI','evidence.view'),('SI','evidence.view_image'),('SI','evidence.export'),
  ('SI','personnel.view'),('SI','availability.manage'),('SI','exception.view'),('SI','exception.manage'),
  ('SI','reports.view'),('SI','reports.export'),('SI','device.view'),('SI','correction.request'),('SI','correction.approve'),
  -- CI: circle-level supervision plus audit review.
  ('CI','web.login'),('CI','mobile.login'),('CI','dashboard.view'),('CI','map.view'),('CI','duty.view'),
  ('CI','duty.view_restricted'),('CI','duty.create'),('CI','duty.assign'),('CI','duty.approve'),('CI','duty.close'),
  ('CI','duty.instructions.publish'),('CI','duty.handover.record'),('CI','roster.view'),('CI','checkin.perform'),
  ('CI','checkin.view'),('CI','evidence.view'),('CI','evidence.view_image'),('CI','evidence.export'),
  ('CI','evidence.package'),('CI','personnel.view'),('CI','availability.manage'),('CI','exception.view'),
  ('CI','exception.manage'),('CI','reports.view'),('CI','reports.export'),('CI','audit.view'),('CI','device.view'),
  ('CI','correction.request'),('CI','correction.approve'),
  -- DSP: aggregated overview; detailed restricted records and images only if explicitly granted.
  ('DSP','web.login'),('DSP','dashboard.view'),('DSP','map.view'),('DSP','duty.view'),('DSP','roster.view'),
  ('DSP','checkin.view'),('DSP','evidence.view'),('DSP','personnel.view'),('DSP','exception.view'),
  ('DSP','reports.view'),('DSP','reports.export'),('DSP','audit.view'),('DSP','device.view'),
  -- Legacy dashboard roles (behaviour of PRAMAAN 1.0 preserved).
  ('SUPERVISOR','web.login'),('SUPERVISOR','dashboard.view'),('SUPERVISOR','map.view'),('SUPERVISOR','personnel.view'),
  ('SUPERVISOR','duty.view'),('SUPERVISOR','duty.view_restricted'),('SUPERVISOR','duty.create'),('SUPERVISOR','duty.assign'),
  ('SUPERVISOR','duty.approve'),('SUPERVISOR','duty.close'),('SUPERVISOR','duty.instructions.publish'),
  ('SUPERVISOR','duty.handover.record'),('SUPERVISOR','roster.view'),('SUPERVISOR','checkin.view'),
  ('SUPERVISOR','evidence.view'),('SUPERVISOR','evidence.view_image'),('SUPERVISOR','evidence.export'),
  ('SUPERVISOR','evidence.package'),('SUPERVISOR','exception.view'),('SUPERVISOR','exception.manage'),
  ('SUPERVISOR','reports.view'),('SUPERVISOR','reports.export'),('SUPERVISOR','audit.view'),('SUPERVISOR','device.view'),
  ('SUPERVISOR','availability.manage'),('SUPERVISOR','correction.approve'),
  ('REVIEWER','web.login'),('REVIEWER','dashboard.view'),('REVIEWER','map.view'),('REVIEWER','personnel.view'),
  ('REVIEWER','duty.view'),('REVIEWER','roster.view'),('REVIEWER','checkin.view'),('REVIEWER','evidence.view'),
  ('REVIEWER','evidence.export'),('REVIEWER','exception.view'),('REVIEWER','reports.view'),('REVIEWER','device.view')
) AS t(r, p);
-- ADMIN: every permission except field-device ones.
INSERT INTO role_permissions (role_code, permission_code)
SELECT 'ADMIN', code FROM permissions WHERE code NOT IN ('checkin.perform','mobile.login');

-- Accounts reference roles; the legacy CHECK constraints are replaced by a foreign key and a trigger.
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS officer_role_link;
ALTER TABLE app_users ADD CONSTRAINT app_users_role_fk FOREIGN KEY (role) REFERENCES roles(code);
CREATE UNIQUE INDEX app_users_officer_unique ON app_users (officer_id) WHERE officer_id IS NOT NULL;

CREATE OR REPLACE FUNCTION pramaan_user_role_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE needs boolean;
BEGIN
  SELECT requires_personnel INTO needs FROM roles WHERE code = NEW.role;
  IF needs AND NEW.officer_id IS NULL THEN
    RAISE EXCEPTION 'Role % requires a linked personnel record', NEW.role USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER app_users_role_guard BEFORE INSERT OR UPDATE ON app_users
  FOR EACH ROW EXECUTE FUNCTION pramaan_user_role_guard();
