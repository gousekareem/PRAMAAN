-- PRAMAAN migration 0002: officers, users, refresh tokens, devices, zones, duty sessions.

CREATE TABLE officers (
  id            uuid PRIMARY KEY,
  employee_ref  text NOT NULL UNIQUE CHECK (employee_ref ~ '^[A-Z0-9-]{3,32}$'), -- pseudonymous internal reference
  display_name  text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  rank          text NOT NULL CHECK (rank IN ('CONSTABLE','HEAD_CONSTABLE','ASI','SI','INSPECTOR','DSP','OTHER')),
  station       text NOT NULL CHECK (length(station) BETWEEN 2 AND 80),
  is_active     boolean NOT NULL DEFAULT true,
  is_demo       boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER officers_touch BEFORE UPDATE ON officers FOR EACH ROW EXECUTE FUNCTION pramaan_touch_updated_at();

CREATE TABLE app_users (
  id                  uuid PRIMARY KEY,
  email               text NOT NULL UNIQUE CHECK (email = lower(email) AND email ~ '^[^@\s]+@[^@\s]+$'),
  display_name        text NOT NULL CHECK (length(display_name) BETWEEN 2 AND 80),
  role                text NOT NULL CHECK (role IN ('ADMIN','SUPERVISOR','REVIEWER','OFFICER')),
  password_hash       text NOT NULL,
  officer_id          uuid REFERENCES officers(id),
  is_active           boolean NOT NULL DEFAULT true,
  is_demo             boolean NOT NULL DEFAULT false,
  failed_login_count  integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until        timestamptz,
  last_login_at       timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT officer_role_link CHECK ((role = 'OFFICER') = (officer_id IS NOT NULL))
);
CREATE TRIGGER app_users_touch BEFORE UPDATE ON app_users FOR EACH ROW EXECUTE FUNCTION pramaan_touch_updated_at();

-- Refresh tokens are stored only as SHA-256 hashes. Rotation uses token families:
-- presenting an already-used token revokes the whole family (reuse detection).
CREATE TABLE refresh_tokens (
  id           uuid PRIMARY KEY,
  user_id      uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  family_id    uuid NOT NULL,
  token_hash   char(64) NOT NULL UNIQUE,
  device_id    uuid,
  issued_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  used_at      timestamptz,
  revoked_at   timestamptz,
  revoke_reason text,
  CHECK (expires_at > issued_at)
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE devices (
  id                        uuid PRIMARY KEY,
  officer_id                uuid NOT NULL REFERENCES officers(id),
  label                     text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  platform                  text NOT NULL CHECK (platform IN ('ANDROID','SIMULATOR')),
  key_algorithm             text NOT NULL CHECK (key_algorithm = 'ECDSA_P256_SHA256'),
  public_key_spki           text NOT NULL,              -- base64 DER SubjectPublicKeyInfo; private keys never leave the device
  key_fingerprint           char(64) NOT NULL UNIQUE,   -- SHA-256 of the SPKI DER
  key_hardware_backed       boolean,
  status                    text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACTIVE','REVOKED')),
  app_version               text,
  is_demo                   boolean NOT NULL DEFAULT false,
  registered_at             timestamptz NOT NULL DEFAULT now(),
  approved_at               timestamptz,
  approved_by               uuid REFERENCES app_users(id),
  revoked_at                timestamptz,
  revoked_by                uuid REFERENCES app_users(id),
  revocation_reason         text,
  last_seen_at              timestamptz,
  CHECK (status <> 'ACTIVE' OR approved_at IS NOT NULL),
  CHECK (status <> 'REVOKED' OR revoked_at IS NOT NULL)
);
CREATE INDEX devices_officer_idx ON devices (officer_id);

-- Trusted anchor: last device chain head received and verified by the server.
CREATE TABLE device_chain_heads (
  device_id        uuid PRIMARY KEY REFERENCES devices(id),
  last_sequence    bigint NOT NULL CHECK (last_sequence > 0),
  last_event_hash  char(64) NOT NULL CHECK (last_event_hash ~ '^[0-9a-f]{64}$'),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Geography(MultiPolygon, 4326): coordinates are WGS84 (longitude, latitude) and
-- distances computed on geography are in metres on the spheroid.
CREATE TABLE geo_zones (
  id          uuid PRIMARY KEY,
  code        text NOT NULL CHECK (code ~ '^[A-Z0-9-]{2,32}$'),
  name        text NOT NULL,
  zone_type   text NOT NULL CHECK (zone_type IN ('STATION','PLATFORM','YARD','TRACK_SECTION','OFFICE','OTHER')),
  geom        geography(MultiPolygon, 4326) NOT NULL,
  srid        integer NOT NULL DEFAULT 4326 CHECK (srid = 4326),
  is_active   boolean NOT NULL DEFAULT true,
  version     integer NOT NULL DEFAULT 1 CHECK (version > 0),
  valid_from  timestamptz NOT NULL DEFAULT now(),
  valid_to    timestamptz,
  is_demo     boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version),
  CHECK (valid_to IS NULL OR valid_to > valid_from),
  CHECK (ST_IsValid(geom::geometry))
);
CREATE INDEX geo_zones_geom_gist ON geo_zones USING gist (geom);

CREATE TABLE duty_sessions (
  id                uuid PRIMARY KEY,
  officer_id        uuid NOT NULL REFERENCES officers(id),
  device_id         uuid REFERENCES devices(id),
  planned_start     timestamptz NOT NULL,
  planned_end       timestamptz NOT NULL,
  status            text NOT NULL DEFAULT 'PLANNED' CHECK (status IN ('PLANNED','ACTIVE','COMPLETED','CANCELLED')),
  device_started_at timestamptz,  -- device-reported (untrusted) start, from DUTY_SESSION_STARTED
  device_ended_at   timestamptz,
  assignment_notes  text CHECK (length(assignment_notes) <= 500),
  authorized_by     uuid NOT NULL REFERENCES app_users(id),
  is_demo           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_end > planned_start),
  CHECK (planned_end - planned_start <= interval '16 hours')
);
CREATE INDEX duty_sessions_officer_idx ON duty_sessions (officer_id, planned_start DESC);
CREATE TRIGGER duty_sessions_touch BEFORE UPDATE ON duty_sessions FOR EACH ROW EXECUTE FUNCTION pramaan_touch_updated_at();

CREATE TABLE duty_zone_assignments (
  duty_session_id uuid NOT NULL REFERENCES duty_sessions(id) ON DELETE CASCADE,
  zone_id         uuid NOT NULL REFERENCES geo_zones(id),
  PRIMARY KEY (duty_session_id, zone_id)
);
