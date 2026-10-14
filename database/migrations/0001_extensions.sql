-- PRAMAAN migration 0001: required extensions.
-- PostGIS is REQUIRED. The migration fails loudly if the server does not provide it;
-- spatial functionality is never silently removed.
CREATE EXTENSION IF NOT EXISTS postgis;

-- Generic helper: maintain updated_at columns.
CREATE OR REPLACE FUNCTION pramaan_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- Generic helper: reject UPDATE/DELETE on append-only tables.
-- A retention purge must explicitly set: SET LOCAL pramaan.retention_purge = 'on'.
CREATE OR REPLACE FUNCTION pramaan_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('pramaan.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END $$;
