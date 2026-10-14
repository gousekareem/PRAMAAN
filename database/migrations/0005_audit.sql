-- PRAMAAN migration 0005: append-only, hash-linked audit / chain-of-custody log.
CREATE TABLE audit_chain_head (
  id             smallint PRIMARY KEY CHECK (id = 1),
  last_sequence  bigint NOT NULL,
  last_hash      char(64) NOT NULL
);
INSERT INTO audit_chain_head VALUES (1, 0, repeat('0', 64));

CREATE TABLE audit_events (
  sequence       bigint PRIMARY KEY CHECK (sequence > 0),
  audit_id       uuid NOT NULL UNIQUE,
  occurred_at    timestamptz NOT NULL,
  actor_user_id  uuid REFERENCES app_users(id),
  actor_role     text,
  action         text NOT NULL,
  target_type    text NOT NULL,
  target_id      text,
  evidence_id    uuid,
  request_id     text,
  details        jsonb NOT NULL DEFAULT '{}',
  previous_hash  char(64) NOT NULL CHECK (previous_hash ~ '^[0-9a-f]{64}$'),
  record_hash    char(64) NOT NULL UNIQUE CHECK (record_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX audit_events_evidence_idx ON audit_events (evidence_id, sequence);
CREATE INDEX audit_events_actor_idx ON audit_events (actor_user_id, sequence DESC);
CREATE INDEX audit_events_action_idx ON audit_events (action, sequence DESC);
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION pramaan_append_only();
-- NOTE: a database superuser or table owner can disable triggers. The hash chain plus
-- exported checkpoints (GET /api/v1/audit-events/checkpoint) make such rewriting detectable
-- only when compared against an independently retained checkpoint.

-- TRUNCATE bypasses row-level triggers, so block it explicitly on append-only tables.
CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION pramaan_append_only();
CREATE TRIGGER device_events_no_truncate BEFORE TRUNCATE ON device_events
  FOR EACH STATEMENT EXECUTE FUNCTION pramaan_append_only();
CREATE TRIGGER ingestion_rejections_no_truncate BEFORE TRUNCATE ON ingestion_rejections
  FOR EACH STATEMENT EXECUTE FUNCTION pramaan_append_only();
CREATE TRIGGER ingestion_conflicts_no_truncate BEFORE TRUNCATE ON ingestion_conflicts
  FOR EACH STATEMENT EXECUTE FUNCTION pramaan_append_only();
