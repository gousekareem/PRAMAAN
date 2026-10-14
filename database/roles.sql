-- OPTIONAL least-privilege setup for self-managed PostgreSQL (managed services such as Render may not
-- allow CREATE ROLE; there the provided user owns the schema). Run as a superuser after migrations.
-- Replace the passwords before use.
CREATE ROLE pramaan_migrator LOGIN PASSWORD 'change-me-migrator';
CREATE ROLE pramaan_app LOGIN PASSWORD 'change-me-app';
GRANT CONNECT ON DATABASE pramaan TO pramaan_app;
GRANT USAGE ON SCHEMA public TO pramaan_app;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO pramaan_app;
-- No DELETE/TRUNCATE for the application role (append-only triggers are a second line of defence).
REVOKE UPDATE ON audit_events, device_events, ingestion_rejections, ingestion_conflicts FROM pramaan_app;
GRANT DELETE ON refresh_tokens TO pramaan_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO pramaan_app;
