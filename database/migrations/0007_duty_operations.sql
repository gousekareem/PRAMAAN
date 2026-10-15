-- PRAMAAN migration 0007: duty categories, configurable staffing/check-in policy, duty assignments,
-- assignment history, instructions, handovers, unavailability, notifications, corrections and
-- exception notes. All defaults are PROTOTYPE CONFIGURATION awaiting departmental validation.

-- ---------------------------------------------------------------------------------------------
-- Duty categories and their configurable policy.
CREATE TABLE duty_categories (
  code                      text PRIMARY KEY CHECK (code IN ('TRAIN_BEAT','STATION_WATCH','VIP_ESCORT','TRACK_INCIDENT')),
  label                     text NOT NULL,
  description               text NOT NULL,
  is_restricted             boolean NOT NULL DEFAULT false,  -- sensitive details limited to duty.view_restricted or assigned personnel
  min_personnel             integer NOT NULL DEFAULT 1 CHECK (min_personnel BETWEEN 1 AND 50),  -- below this: warning only
  requires_supervisor       boolean NOT NULL DEFAULT false,  -- missing supervisor: warning only
  accept_required           boolean NOT NULL DEFAULT false,
  eligibility_mode          text NOT NULL DEFAULT 'BLOCK' CHECK (eligibility_mode IN ('BLOCK','WARN')),
  checkin_min_interval_min  integer NOT NULL CHECK (checkin_min_interval_min BETWEEN 5 AND 600),
  checkin_max_interval_min  integer NOT NULL CHECK (checkin_max_interval_min BETWEEN 5 AND 600),
  response_window_sec       integer NOT NULL CHECK (response_window_sec BETWEEN 30 AND 1800),
  reporting_window_min      integer NOT NULL CHECK (reporting_window_min BETWEEN 0 AND 240),
  grace_min                 integer NOT NULL CHECK (grace_min BETWEEN 0 AND 120),
  max_duration_hours        integer NOT NULL DEFAULT 16 CHECK (max_duration_hours BETWEEN 1 AND 16),
  policy_version            integer NOT NULL DEFAULT 1 CHECK (policy_version > 0),
  requires_validation_note  text NOT NULL DEFAULT 'Prototype default — confirm with the department before operational use.',
  updated_at                timestamptz NOT NULL DEFAULT now(),
  updated_by                uuid REFERENCES app_users(id),
  CHECK (checkin_max_interval_min >= checkin_min_interval_min)
);
INSERT INTO duty_categories (code, label, description, is_restricted, min_personnel, requires_supervisor, accept_required,
  checkin_min_interval_min, checkin_max_interval_min, response_window_sec, reporting_window_min, grace_min) VALUES
  ('TRAIN_BEAT',     'Train Beat',     'Personnel accompanying or patrolling a train according to the duty plan.', false, 1, false, false, 60, 120, 180, 30, 10),
  ('STATION_WATCH',  'Station Watch',  'Personnel watching or patrolling a railway station during a shift.',     false, 1, false, false, 90, 150, 180, 15, 10),
  ('VIP_ESCORT',     'VIP Escort',     'Restricted escort or protection duty (synthetic labels only in the demo).', true, 1, true, true, 45, 90, 120, 15, 5),
  ('TRACK_INCIDENT', 'Track Incident', 'Accident / track-incident response duty (synthetic incidents only in the demo).', true, 1, true, false, 60, 120, 180, 30, 15);

-- Personnel classes eligible per category. Classes: HG, PC_AR, PC_GENERAL, PC (subtype not recorded),
-- HC, ASI, SI, CI, DSP, OTHER. No fixed AR/General combination is required anywhere.
CREATE TABLE duty_category_eligibility (
  category_code    text NOT NULL REFERENCES duty_categories(code),
  personnel_class  text NOT NULL CHECK (personnel_class IN ('HG','PC_AR','PC_GENERAL','PC','HC','ASI','SI','CI','DSP','OTHER')),
  PRIMARY KEY (category_code, personnel_class)
);
INSERT INTO duty_category_eligibility (category_code, personnel_class)
SELECT c, p FROM (VALUES ('TRAIN_BEAT'),('STATION_WATCH'),('VIP_ESCORT'),('TRACK_INCIDENT')) AS cats(c)
CROSS JOIN (VALUES ('HG'),('PC_AR'),('PC_GENERAL'),('PC'),('HC'),('ASI'),('SI')) AS cls(p);
INSERT INTO duty_category_eligibility (category_code, personnel_class) VALUES ('VIP_ESCORT','CI');

-- ---------------------------------------------------------------------------------------------
-- Duty assignments: one operational duty with one or more personnel. Each assigned person gets an
-- individual duty_session (PRAMAAN 1.0 table) so device check-ins and evidence link to both.
CREATE TABLE duty_assignments (
  id                  uuid PRIMARY KEY,
  reference_code      text NOT NULL UNIQUE CHECK (reference_code ~ '^[A-Z0-9-]{3,40}$'),
  category            text NOT NULL REFERENCES duty_categories(code),
  title               text NOT NULL CHECK (length(title) BETWEEN 3 AND 120),
  unit_id             uuid NOT NULL REFERENCES units(id),
  planned_start       timestamptz NOT NULL,
  planned_end         timestamptz NOT NULL,
  reporting_location  text CHECK (length(reporting_location) <= 160),
  train_ref           text CHECK (length(train_ref) <= 60),            -- synthetic train/service reference
  station_unit_id     uuid REFERENCES units(id),
  escort_label        text CHECK (length(escort_label) <= 80),         -- synthetic VIP label only
  incident_ref        text CHECK (length(incident_ref) <= 60),         -- fictional incident reference
  notes               text CHECK (length(notes) <= 1000),
  status              text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ASSIGNED','ACCEPTED','IN_PROGRESS','COMPLETED','EXCEPTION_REPORTED','CANCELLED')),
  supervisor_officer_id uuid REFERENCES officers(id),
  accept_required     boolean NOT NULL DEFAULT false,
  policy_version      integer NOT NULL DEFAULT 1,
  created_by          uuid NOT NULL REFERENCES app_users(id),
  completion_note     text CHECK (length(completion_note) <= 1000),
  completed_at        timestamptz,
  completed_by        uuid REFERENCES app_users(id),
  cancelled_reason    text CHECK (length(cancelled_reason) <= 500),
  is_demo             boolean NOT NULL DEFAULT false,
  version             integer NOT NULL DEFAULT 1,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end > planned_start),
  CHECK (planned_end - planned_start <= interval '16 hours'),
  CHECK (status <> 'COMPLETED' OR completed_at IS NOT NULL)
);
CREATE INDEX duty_assignments_unit_time_idx ON duty_assignments (unit_id, planned_start DESC);
CREATE INDEX duty_assignments_category_idx ON duty_assignments (category, planned_start DESC);
CREATE INDEX duty_assignments_status_idx ON duty_assignments (status);
CREATE TRIGGER duty_assignments_touch BEFORE UPDATE ON duty_assignments FOR EACH ROW EXECUTE FUNCTION pramaan_touch_updated_at();
CREATE TRIGGER duty_assignments_no_delete BEFORE DELETE ON duty_assignments FOR EACH ROW EXECUTE FUNCTION pramaan_no_delete();

CREATE TABLE duty_assignment_personnel (
  id                 uuid PRIMARY KEY,
  assignment_id      uuid NOT NULL REFERENCES duty_assignments(id),
  officer_id         uuid NOT NULL REFERENCES officers(id),
  duty_session_id    uuid UNIQUE REFERENCES duty_sessions(id),   -- created when the assignment is published
  role_in_duty       text NOT NULL DEFAULT 'MEMBER' CHECK (role_in_duty IN ('LEAD','MEMBER')),
  status             text NOT NULL DEFAULT 'ASSIGNED' CHECK (status IN ('ASSIGNED','ACCEPTED','REMOVED','REPLACED')),
  personnel_class    text NOT NULL,      -- snapshot at assignment time (e.g. PC_AR), for history
  assigned_by        uuid NOT NULL REFERENCES app_users(id),
  assigned_at        timestamptz NOT NULL DEFAULT now(),
  accepted_at        timestamptz,
  removed_by         uuid REFERENCES app_users(id),
  removed_at         timestamptz,
  removal_reason     text CHECK (length(removal_reason) <= 500),
  replaced_by_id     uuid REFERENCES duty_assignment_personnel(id),
  conflict_override_reason text CHECK (length(conflict_override_reason) <= 500),
  CHECK ((status IN ('REMOVED','REPLACED')) = (removed_at IS NOT NULL))
);
CREATE UNIQUE INDEX dap_one_active_per_person ON duty_assignment_personnel (assignment_id, officer_id)
  WHERE status IN ('ASSIGNED','ACCEPTED');
CREATE INDEX dap_officer_idx ON duty_assignment_personnel (officer_id);
CREATE TRIGGER dap_no_delete BEFORE DELETE ON duty_assignment_personnel FOR EACH ROW EXECUTE FUNCTION pramaan_no_delete();

-- Append-only change history (status transitions, personnel changes, schedule changes) with reason.
CREATE TABLE duty_assignment_changes (
  id             uuid PRIMARY KEY,
  assignment_id  uuid NOT NULL REFERENCES duty_assignments(id),
  change_type    text NOT NULL CHECK (change_type IN ('CREATED','STATUS_CHANGED','PERSONNEL_ADDED','PERSONNEL_REMOVED','PERSONNEL_REPLACED',
                                                      'PERSONNEL_ACCEPTED','SCHEDULE_CHANGED','DETAILS_CHANGED','INSTRUCTIONS_PUBLISHED','HANDOVER_RECORDED')),
  before_value   jsonb,
  after_value    jsonb,
  reason         text CHECK (length(reason) <= 500),
  actor_user_id  uuid REFERENCES app_users(id),
  occurred_at    timestamptz NOT NULL DEFAULT clock_timestamp(),
  seq            bigserial NOT NULL          -- strict insertion order, even within one transaction
);
CREATE INDEX duty_assignment_changes_idx ON duty_assignment_changes (assignment_id, seq);
CREATE TRIGGER duty_assignment_changes_append_only BEFORE UPDATE OR DELETE ON duty_assignment_changes
  FOR EACH ROW EXECUTE FUNCTION pramaan_append_only();

-- Versioned instructions (never edited; a new version supersedes) and acknowledgements.
CREATE TABLE duty_instructions (
  id             uuid PRIMARY KEY,
  assignment_id  uuid NOT NULL REFERENCES duty_assignments(id),
  version        integer NOT NULL CHECK (version > 0),
  body           text NOT NULL CHECK (length(body) BETWEEN 3 AND 4000),
  body_sha256    char(64) NOT NULL,
  published_by   uuid NOT NULL REFERENCES app_users(id),
  published_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (assignment_id, version)
);
CREATE TRIGGER duty_instructions_append_only BEFORE UPDATE OR DELETE ON duty_instructions
  FOR EACH ROW EXECUTE FUNCTION pramaan_append_only();

CREATE TABLE duty_instruction_acks (
  instruction_id  uuid NOT NULL REFERENCES duty_instructions(id),
  officer_id      uuid NOT NULL REFERENCES officers(id),
  user_id         uuid NOT NULL REFERENCES app_users(id),
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (instruction_id, officer_id)
);

-- Duty handovers.
CREATE TABLE duty_handovers (
  id                    uuid PRIMARY KEY,
  assignment_id         uuid NOT NULL REFERENCES duty_assignments(id),
  outgoing_officer_id   uuid NOT NULL REFERENCES officers(id),
  incoming_officer_id   uuid NOT NULL REFERENCES officers(id),
  handover_at           timestamptz NOT NULL,
  outstanding_tasks     text CHECK (length(outstanding_tasks) <= 2000),
  recorded_by           uuid NOT NULL REFERENCES app_users(id),
  recorded_at           timestamptz NOT NULL DEFAULT now(),
  outgoing_ack_at       timestamptz,
  incoming_ack_at       timestamptz,
  CHECK (outgoing_officer_id <> incoming_officer_id)
);
CREATE INDEX duty_handovers_assignment_idx ON duty_handovers (assignment_id, handover_at);

-- Configured unavailability. Generic categories only; no official leave rules are modelled.
CREATE TABLE personnel_unavailability (
  id            uuid PRIMARY KEY,
  officer_id    uuid NOT NULL REFERENCES officers(id),
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz NOT NULL,
  category      text NOT NULL CHECK (category IN ('LEAVE','TRAINING','COURT_ATTENDANCE','MEDICAL','OTHER')),
  note          text CHECK (length(note) <= 300),
  recorded_by   uuid NOT NULL REFERENCES app_users(id),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  cancelled_at  timestamptz,
  cancelled_by  uuid REFERENCES app_users(id),
  is_demo       boolean NOT NULL DEFAULT false,
  CHECK (ends_at > starts_at)
);
CREATE INDEX personnel_unavailability_idx ON personnel_unavailability (officer_id, starts_at);

-- In-app notifications. delivery_status is truthful: QUEUED until the recipient's signed-in client
-- actually retrieves it (DELIVERED), READ once opened. There is no push channel in this prototype.
CREATE TABLE notifications (
  id               uuid PRIMARY KEY,
  recipient_user_id uuid NOT NULL REFERENCES app_users(id),
  kind             text NOT NULL CHECK (kind IN ('ASSIGNMENT','ASSIGNMENT_CHANGED','INSTRUCTIONS','EXCEPTION','HANDOVER','CORRECTION')),
  title            text NOT NULL,
  body             text NOT NULL,
  related_type     text,
  related_id       uuid,
  delivery_status  text NOT NULL DEFAULT 'QUEUED' CHECK (delivery_status IN ('QUEUED','DELIVERED','READ')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  delivered_at     timestamptz,
  read_at          timestamptz,
  dedupe_key       text UNIQUE
);
CREATE INDEX notifications_recipient_idx ON notifications (recipient_user_id, created_at DESC);

-- Audited corrections: originals are NEVER overwritten. A correction stores the original value read
-- by the server, the proposed value, reason, requester and the approval decision.
CREATE TABLE record_corrections (
  id               uuid PRIMARY KEY,
  target_type      text NOT NULL CHECK (target_type IN ('CHECKIN','DUTY_PERSONNEL','EVIDENCE')),
  target_id        uuid NOT NULL,
  field_name       text NOT NULL,
  original_value   jsonb,
  corrected_value  jsonb NOT NULL,
  reason           text NOT NULL CHECK (length(reason) BETWEEN 5 AND 500),
  requested_by     uuid NOT NULL REFERENCES app_users(id),
  requested_at     timestamptz NOT NULL DEFAULT now(),
  status           text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  decided_by       uuid REFERENCES app_users(id),
  decided_at       timestamptz,
  decision_note    text CHECK (length(decision_note) <= 500),
  CHECK ((status = 'PENDING') = (decided_at IS NULL)),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)
);
CREATE INDEX record_corrections_target_idx ON record_corrections (target_type, target_id);
CREATE OR REPLACE FUNCTION pramaan_correction_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'record_corrections rows cannot be deleted'; END IF;
  IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'a decided correction is immutable'; END IF;
  IF NEW.original_value IS DISTINCT FROM OLD.original_value OR NEW.corrected_value IS DISTINCT FROM OLD.corrected_value
     OR NEW.target_id <> OLD.target_id OR NEW.field_name <> OLD.field_name OR NEW.reason <> OLD.reason
     OR NEW.requested_by <> OLD.requested_by THEN
    RAISE EXCEPTION 'correction request content is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER record_corrections_guard BEFORE UPDATE OR DELETE ON record_corrections
  FOR EACH ROW EXECUTE FUNCTION pramaan_correction_guard();

-- ---------------------------------------------------------------------------------------------
-- Exceptions reuse review_flags (PRAMAAN 1.0) with additional operational types and a duty link.
ALTER TABLE review_flags DROP CONSTRAINT IF EXISTS review_flags_flag_type_check;
ALTER TABLE review_flags ADD CONSTRAINT review_flags_flag_type_check CHECK (flag_type IN (
  'CHECKIN_MISSED','CHECKIN_LATE','CLOCK_ANOMALY','MOCK_LOCATION_INDICATOR','EVIDENCE_HASH_MISMATCH',
  'INVALID_DEVICE_SIGNATURE','SEQUENCE_GAP','CHAIN_LINK_MISMATCH','EVENT_CONFLICT','SPATIAL_ZONE_EXCEPTION',
  'MOVEMENT_INCONSISTENCY','DEVICE_REGISTRATION','DEVICE_REVOCATION','DEVICE_INTEGRITY','SCREEN_RECAPTURE_RISK',
  'DUTY_REPORTING_DELAYED','DUTY_OVERDUE','SYNC_FAILURE','ASSIGNMENT_CONFLICT','INACTIVE_PERSONNEL_ASSIGNED',
  'DUTY_EXCEPTION_REPORTED'));
ALTER TABLE review_flags ADD COLUMN duty_assignment_id uuid REFERENCES duty_assignments(id);
CREATE INDEX review_flags_assignment_idx ON review_flags (duty_assignment_id);

-- Investigation notes on exceptions (append-only).
CREATE TABLE review_flag_notes (
  id             uuid PRIMARY KEY,
  flag_id        uuid NOT NULL REFERENCES review_flags(id),
  author_user_id uuid NOT NULL REFERENCES app_users(id),
  note           text NOT NULL CHECK (length(note) BETWEEN 3 AND 2000),
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_flag_notes_flag_idx ON review_flag_notes (flag_id, created_at);
CREATE TRIGGER review_flag_notes_append_only BEFORE UPDATE OR DELETE ON review_flag_notes
  FOR EACH ROW EXECUTE FUNCTION pramaan_append_only();

-- Device-reported reporting time per assigned person (derived from DUTY_SESSION_STARTED; untrusted
-- device time is kept alongside the server receipt time). Not proof of physical attendance.
ALTER TABLE duty_sessions ADD COLUMN server_started_received_at timestamptz;
