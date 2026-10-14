-- PRAMAAN migration 0003: device event ingestion (original observations, append-only).

CREATE TABLE sync_batches (
  batch_id         uuid PRIMARY KEY,                 -- idempotency key chosen by the device
  device_id        uuid NOT NULL REFERENCES devices(id),
  request_sha256   char(64) NOT NULL,                -- hash of the canonical batch; reuse with different content = 409
  received_at      timestamptz NOT NULL DEFAULT now(),
  processed_at     timestamptz,
  event_count      integer NOT NULL CHECK (event_count > 0),
  accepted_count   integer NOT NULL DEFAULT 0,
  duplicate_count  integer NOT NULL DEFAULT 0,
  rejected_count   integer NOT NULL DEFAULT 0,
  response_json    jsonb,
  request_id       text
);
CREATE INDEX sync_batches_device_idx ON sync_batches (device_id, received_at DESC);

-- One row per accepted device event. The full original envelope is preserved verbatim
-- (as JSON) so the event hash and signature can be re-verified at any time.
CREATE TABLE device_events (
  event_id                 uuid PRIMARY KEY,
  device_id                uuid NOT NULL REFERENCES devices(id),
  officer_id               uuid NOT NULL REFERENCES officers(id),
  duty_session_id          uuid REFERENCES duty_sessions(id),
  device_sequence_number   bigint NOT NULL CHECK (device_sequence_number > 0),
  event_type               text NOT NULL,
  schema_version           integer NOT NULL,
  device_wall_time         timestamptz NOT NULL,     -- device-reported, NOT trusted
  monotonic_elapsed_ms     bigint NOT NULL,
  boot_id                  text NOT NULL,
  trusted_time_estimate    timestamptz,              -- anchored estimate (may be null)
  trusted_time_uncertainty_ms integer,
  trusted_time_source      text NOT NULL,
  payload                  jsonb NOT NULL,
  previous_event_hash      char(64) NOT NULL CHECK (previous_event_hash ~ '^[0-9a-f]{64}$'),
  event_hash               char(64) NOT NULL UNIQUE CHECK (event_hash ~ '^[0-9a-f]{64}$'),
  device_signature         text NOT NULL,
  signature_status         text NOT NULL CHECK (signature_status = 'VALID'),
  chain_link_status        text NOT NULL CHECK (chain_link_status IN ('GENESIS','LINKED','GAP_BEFORE')),
  envelope                 jsonb NOT NULL,
  batch_id                 uuid NOT NULL REFERENCES sync_batches(batch_id),
  request_id               text,
  server_received_at       timestamptz NOT NULL,     -- when the HTTP request arrived
  server_processed_at      timestamptz NOT NULL DEFAULT clock_timestamp(), -- when this row was committed
  UNIQUE (device_id, device_sequence_number)
);
CREATE INDEX device_events_session_idx ON device_events (duty_session_id, device_sequence_number);
CREATE INDEX device_events_type_idx ON device_events (event_type, server_received_at DESC);
CREATE INDEX device_events_officer_time_idx ON device_events (officer_id, device_wall_time DESC);
CREATE TRIGGER device_events_append_only BEFORE UPDATE OR DELETE ON device_events
  FOR EACH ROW EXECUTE FUNCTION pramaan_append_only();

-- Rejected / quarantined submissions are preserved for review, never silently dropped.
CREATE TABLE ingestion_rejections (
  id               uuid PRIMARY KEY,
  batch_id         uuid NOT NULL,
  device_id        uuid NOT NULL REFERENCES devices(id),
  event_id_text    text,
  device_sequence_number bigint,
  reason_code      text NOT NULL,
  detail           text NOT NULL,
  submitted_sha256 char(64) NOT NULL,
  submitted_event  jsonb,
  request_id       text,
  received_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingestion_rejections_device_idx ON ingestion_rejections (device_id, received_at DESC);
CREATE TRIGGER ingestion_rejections_append_only BEFORE UPDATE OR DELETE ON ingestion_rejections
  FOR EACH ROW EXECUTE FUNCTION pramaan_append_only();

-- Same event_id (or same device sequence) re-submitted with DIFFERENT content.
CREATE TABLE ingestion_conflicts (
  id                     uuid PRIMARY KEY,
  device_id              uuid NOT NULL REFERENCES devices(id),
  event_id               uuid NOT NULL,
  device_sequence_number bigint,
  existing_event_hash    char(64) NOT NULL,
  conflicting_event_hash text,
  conflicting_event      jsonb NOT NULL,
  batch_id               uuid NOT NULL,
  detected_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ingestion_conflicts_device_idx ON ingestion_conflicts (device_id, detected_at DESC);
CREATE TRIGGER ingestion_conflicts_append_only BEFORE UPDATE OR DELETE ON ingestion_conflicts
  FOR EACH ROW EXECUTE FUNCTION pramaan_append_only();
