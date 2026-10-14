-- PRAMAAN migration 0004: server-derived records (patrol logs, check-ins, evidence, review flags).
-- Derived rows reference the original device_events row; resolving a flag never alters the original.

CREATE TABLE patrol_logs (
  id                          uuid PRIMARY KEY,
  event_id                    uuid NOT NULL UNIQUE REFERENCES device_events(event_id),
  officer_id                  uuid NOT NULL REFERENCES officers(id),
  duty_session_id             uuid REFERENCES duty_sessions(id),
  device_id                   uuid NOT NULL REFERENCES devices(id),
  event_type                  text NOT NULL,
  location                    geography(Point, 4326),        -- ST_MakePoint(longitude, latitude)
  horizontal_accuracy_m       double precision CHECK (horizontal_accuracy_m IS NULL OR horizontal_accuracy_m >= 0),
  recorded_device_time        timestamptz NOT NULL,
  trusted_time_estimate       timestamptz,
  server_received_at          timestamptz NOT NULL,
  evidence_id                 uuid,
  verification_status         text NOT NULL CHECK (verification_status IN ('SIGNATURE_VALID','EVIDENCE_PENDING','EVIDENCE_VERIFIED','EVIDENCE_QUARANTINED')),
  spatial_result              text NOT NULL CHECK (spatial_result IN ('INSIDE_ASSIGNED_ZONE','OUTSIDE_WITHIN_ACCURACY','OUTSIDE_ASSIGNED_ZONE','NO_ASSIGNED_ZONE','NO_LOCATION')),
  matched_zone_ids            uuid[] NOT NULL DEFAULT '{}',
  distance_to_assigned_zone_m double precision,
  mock_indicator              boolean,
  created_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX patrol_logs_location_gist ON patrol_logs USING gist (location);
CREATE INDEX patrol_logs_officer_time_idx ON patrol_logs (officer_id, recorded_device_time DESC);
CREATE INDEX patrol_logs_session_idx ON patrol_logs (duty_session_id, recorded_device_time);
CREATE INDEX patrol_logs_received_idx ON patrol_logs (server_received_at DESC);

CREATE TABLE evidence_objects (
  evidence_id            uuid PRIMARY KEY,
  event_id               uuid NOT NULL UNIQUE REFERENCES device_events(event_id),
  device_id              uuid NOT NULL REFERENCES devices(id),
  officer_id             uuid NOT NULL REFERENCES officers(id),
  duty_session_id        uuid REFERENCES duty_sessions(id),
  declared_image_sha256  char(64) NOT NULL CHECK (declared_image_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256        char(64) NOT NULL CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  manifest               jsonb NOT NULL,
  media_type             text NOT NULL CHECK (media_type = 'image/jpeg'),
  declared_byte_length   integer NOT NULL CHECK (declared_byte_length > 0),
  status                 text NOT NULL DEFAULT 'AWAITING_UPLOAD' CHECK (status IN ('AWAITING_UPLOAD','VERIFIED','QUARANTINED')),
  received_byte_length   integer,
  computed_image_sha256  char(64),
  storage_ref            text,
  verification_detail    jsonb,
  screen_risk            jsonb,
  upload_attempts        integer NOT NULL DEFAULT 0,
  upload_received_at     timestamptz,
  verified_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'VERIFIED' OR computed_image_sha256 = declared_image_sha256)
);
CREATE INDEX evidence_objects_officer_idx ON evidence_objects (officer_id, created_at DESC);
CREATE INDEX evidence_objects_status_idx ON evidence_objects (status);

-- Declared hashes and manifest of an evidence object can never be edited.
CREATE OR REPLACE FUNCTION pramaan_evidence_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('pramaan.retention_purge', true) = 'on' THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'evidence_objects rows cannot be deleted outside a retention purge';
  END IF;
  IF NEW.declared_image_sha256 <> OLD.declared_image_sha256 OR NEW.manifest_sha256 <> OLD.manifest_sha256
     OR NEW.manifest <> OLD.manifest OR NEW.event_id <> OLD.event_id THEN
    RAISE EXCEPTION 'evidence declarations are immutable';
  END IF;
  IF OLD.status = 'VERIFIED' AND (NEW.status <> 'VERIFIED' OR NEW.computed_image_sha256 <> OLD.computed_image_sha256 OR NEW.storage_ref <> OLD.storage_ref) THEN
    RAISE EXCEPTION 'verified evidence is immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER evidence_objects_guard BEFORE UPDATE OR DELETE ON evidence_objects
  FOR EACH ROW EXECUTE FUNCTION pramaan_evidence_guard();

-- Check-in lifecycle (derived from the device events of one checkin_id).
CREATE TABLE checkins (
  checkin_id            uuid PRIMARY KEY,
  device_id             uuid NOT NULL REFERENCES devices(id),
  officer_id            uuid NOT NULL REFERENCES officers(id),
  duty_session_id       uuid REFERENCES duty_sessions(id),
  scheduled_for         timestamptz,
  deadline_at           timestamptz,
  status                text NOT NULL CHECK (status IN ('SCHEDULED','PRESENTED','ACKNOWLEDGED','ACKNOWLEDGED_LATE','MISSED')),
  biometric_result      text CHECK (biometric_result IN ('SUCCESS','FAILURE')),
  challenge_result      text CHECK (challenge_result IN ('SUCCESS','FAILURE')),
  challenge_elapsed_ms  integer,
  response_ms           integer,
  late_by_ms            integer,
  missed_reason         text,
  event_ids             uuid[] NOT NULL DEFAULT '{}',
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX checkins_officer_idx ON checkins (officer_id, scheduled_for DESC);
CREATE INDEX checkins_status_idx ON checkins (status);

CREATE TABLE review_flags (
  id               uuid PRIMARY KEY,
  flag_type        text NOT NULL CHECK (flag_type IN (
                     'CHECKIN_MISSED','CHECKIN_LATE','CLOCK_ANOMALY','MOCK_LOCATION_INDICATOR','EVIDENCE_HASH_MISMATCH',
                     'INVALID_DEVICE_SIGNATURE','SEQUENCE_GAP','CHAIN_LINK_MISMATCH','EVENT_CONFLICT','SPATIAL_ZONE_EXCEPTION',
                     'MOVEMENT_INCONSISTENCY','DEVICE_REGISTRATION','DEVICE_REVOCATION','DEVICE_INTEGRITY','SCREEN_RECAPTURE_RISK')),
  severity         text NOT NULL CHECK (severity IN ('INFO','LOW','MEDIUM','HIGH')),
  status           text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','ASSIGNED','RESOLVED','DISMISSED')),
  title            text NOT NULL,
  description      text NOT NULL,
  officer_id       uuid REFERENCES officers(id),
  device_id        uuid REFERENCES devices(id),
  duty_session_id  uuid REFERENCES duty_sessions(id),
  event_id         uuid,
  evidence_id      uuid,
  inputs           jsonb NOT NULL DEFAULT '{}',   -- evidence used to produce the flag
  dedupe_key       text NOT NULL UNIQUE,
  assigned_to      uuid REFERENCES app_users(id),
  acknowledged_by  uuid REFERENCES app_users(id),
  acknowledged_at  timestamptz,
  resolved_by      uuid REFERENCES app_users(id),
  resolved_at      timestamptz,
  resolution_note  text CHECK (length(resolution_note) <= 1000),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX review_flags_status_idx ON review_flags (status, created_at DESC);
CREATE INDEX review_flags_officer_idx ON review_flags (officer_id, created_at DESC);
CREATE TRIGGER review_flags_touch BEFORE UPDATE ON review_flags FOR EACH ROW EXECUTE FUNCTION pramaan_touch_updated_at();

-- Retention configuration (days). Enforced by the purge procedure documented in docs/privacy-governance.md.
CREATE TABLE retention_policies (
  category     text PRIMARY KEY,
  retain_days  integer NOT NULL CHECK (retain_days BETWEEN 1 AND 3650),
  description  text NOT NULL
);
INSERT INTO retention_policies (category, retain_days, description) VALUES
  ('LOCATION_OBSERVATIONS', 180, 'LOCATION_OBSERVED events and derived patrol logs without linked evidence or open flags'),
  ('EVIDENCE_IMAGES', 730, 'Evidence image bytes not referenced by an open review flag'),
  ('AUDIT_EVENTS', 2555, 'Chain-of-custody / audit records (7 years)'),
  ('REJECTED_SUBMISSIONS', 365, 'Quarantined / rejected submissions');
