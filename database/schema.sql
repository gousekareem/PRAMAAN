-- PRAMAAN schema snapshot (pg_dump --schema-only after migrations 0001-0005). Reference only.
--
-- PostgreSQL database dump
--

\restrict PqezK7lEn8OKLcAgPoQ2uYu9jO0tsmMOafvubriUF2dYQ473Y8dnLD6VOPmk4Ja


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: pramaan_append_only(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pramaan_append_only() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('pramaan.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'P0001';
END $$;


--
-- Name: pramaan_evidence_guard(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pramaan_evidence_guard() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
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


--
-- Name: pramaan_touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.pramaan_touch_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: app_users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.app_users (
    id uuid NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    role text NOT NULL,
    password_hash text NOT NULL,
    officer_id uuid,
    is_active boolean DEFAULT true NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT app_users_display_name_check CHECK (((length(display_name) >= 2) AND (length(display_name) <= 80))),
    CONSTRAINT app_users_email_check CHECK (((email = lower(email)) AND (email ~ '^[^@\s]+@[^@\s]+$'::text))),
    CONSTRAINT app_users_failed_login_count_check CHECK ((failed_login_count >= 0)),
    CONSTRAINT app_users_role_check CHECK ((role = ANY (ARRAY['ADMIN'::text, 'SUPERVISOR'::text, 'REVIEWER'::text, 'OFFICER'::text]))),
    CONSTRAINT officer_role_link CHECK (((role = 'OFFICER'::text) = (officer_id IS NOT NULL)))
);


--
-- Name: audit_chain_head; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_chain_head (
    id smallint NOT NULL,
    last_sequence bigint NOT NULL,
    last_hash character(64) NOT NULL,
    CONSTRAINT audit_chain_head_id_check CHECK ((id = 1))
);


--
-- Name: audit_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_events (
    sequence bigint NOT NULL,
    audit_id uuid NOT NULL,
    occurred_at timestamp with time zone NOT NULL,
    actor_user_id uuid,
    actor_role text,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    evidence_id uuid,
    request_id text,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    previous_hash character(64) NOT NULL,
    record_hash character(64) NOT NULL,
    CONSTRAINT audit_events_previous_hash_check CHECK ((previous_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT audit_events_record_hash_check CHECK ((record_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT audit_events_sequence_check CHECK ((sequence > 0))
);


--
-- Name: checkins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.checkins (
    checkin_id uuid NOT NULL,
    device_id uuid NOT NULL,
    officer_id uuid NOT NULL,
    duty_session_id uuid,
    scheduled_for timestamp with time zone,
    deadline_at timestamp with time zone,
    status text NOT NULL,
    biometric_result text,
    challenge_result text,
    challenge_elapsed_ms integer,
    response_ms integer,
    late_by_ms integer,
    missed_reason text,
    event_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT checkins_biometric_result_check CHECK ((biometric_result = ANY (ARRAY['SUCCESS'::text, 'FAILURE'::text]))),
    CONSTRAINT checkins_challenge_result_check CHECK ((challenge_result = ANY (ARRAY['SUCCESS'::text, 'FAILURE'::text]))),
    CONSTRAINT checkins_status_check CHECK ((status = ANY (ARRAY['SCHEDULED'::text, 'PRESENTED'::text, 'ACKNOWLEDGED'::text, 'ACKNOWLEDGED_LATE'::text, 'MISSED'::text])))
);


--
-- Name: device_chain_heads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_chain_heads (
    device_id uuid NOT NULL,
    last_sequence bigint NOT NULL,
    last_event_hash character(64) NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT device_chain_heads_last_event_hash_check CHECK ((last_event_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT device_chain_heads_last_sequence_check CHECK ((last_sequence > 0))
);


--
-- Name: device_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.device_events (
    event_id uuid NOT NULL,
    device_id uuid NOT NULL,
    officer_id uuid NOT NULL,
    duty_session_id uuid,
    device_sequence_number bigint NOT NULL,
    event_type text NOT NULL,
    schema_version integer NOT NULL,
    device_wall_time timestamp with time zone NOT NULL,
    monotonic_elapsed_ms bigint NOT NULL,
    boot_id text NOT NULL,
    trusted_time_estimate timestamp with time zone,
    trusted_time_uncertainty_ms integer,
    trusted_time_source text NOT NULL,
    payload jsonb NOT NULL,
    previous_event_hash character(64) NOT NULL,
    event_hash character(64) NOT NULL,
    device_signature text NOT NULL,
    signature_status text NOT NULL,
    chain_link_status text NOT NULL,
    envelope jsonb NOT NULL,
    batch_id uuid NOT NULL,
    request_id text,
    server_received_at timestamp with time zone NOT NULL,
    server_processed_at timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
    CONSTRAINT device_events_chain_link_status_check CHECK ((chain_link_status = ANY (ARRAY['GENESIS'::text, 'LINKED'::text, 'GAP_BEFORE'::text]))),
    CONSTRAINT device_events_device_sequence_number_check CHECK ((device_sequence_number > 0)),
    CONSTRAINT device_events_event_hash_check CHECK ((event_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT device_events_previous_event_hash_check CHECK ((previous_event_hash ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT device_events_signature_status_check CHECK ((signature_status = 'VALID'::text))
);


--
-- Name: devices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.devices (
    id uuid NOT NULL,
    officer_id uuid NOT NULL,
    label text NOT NULL,
    platform text NOT NULL,
    key_algorithm text NOT NULL,
    public_key_spki text NOT NULL,
    key_fingerprint character(64) NOT NULL,
    key_hardware_backed boolean,
    status text DEFAULT 'PENDING'::text NOT NULL,
    app_version text,
    is_demo boolean DEFAULT false NOT NULL,
    registered_at timestamp with time zone DEFAULT now() NOT NULL,
    approved_at timestamp with time zone,
    approved_by uuid,
    revoked_at timestamp with time zone,
    revoked_by uuid,
    revocation_reason text,
    last_seen_at timestamp with time zone,
    CONSTRAINT devices_check CHECK (((status <> 'ACTIVE'::text) OR (approved_at IS NOT NULL))),
    CONSTRAINT devices_check1 CHECK (((status <> 'REVOKED'::text) OR (revoked_at IS NOT NULL))),
    CONSTRAINT devices_key_algorithm_check CHECK ((key_algorithm = 'ECDSA_P256_SHA256'::text)),
    CONSTRAINT devices_label_check CHECK (((length(label) >= 1) AND (length(label) <= 80))),
    CONSTRAINT devices_platform_check CHECK ((platform = ANY (ARRAY['ANDROID'::text, 'SIMULATOR'::text]))),
    CONSTRAINT devices_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'ACTIVE'::text, 'REVOKED'::text])))
);


--
-- Name: duty_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.duty_sessions (
    id uuid NOT NULL,
    officer_id uuid NOT NULL,
    device_id uuid,
    planned_start timestamp with time zone NOT NULL,
    planned_end timestamp with time zone NOT NULL,
    status text DEFAULT 'PLANNED'::text NOT NULL,
    device_started_at timestamp with time zone,
    device_ended_at timestamp with time zone,
    assignment_notes text,
    authorized_by uuid NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT duty_sessions_assignment_notes_check CHECK ((length(assignment_notes) <= 500)),
    CONSTRAINT duty_sessions_check CHECK ((planned_end > planned_start)),
    CONSTRAINT duty_sessions_check1 CHECK (((planned_end - planned_start) <= '16:00:00'::interval)),
    CONSTRAINT duty_sessions_status_check CHECK ((status = ANY (ARRAY['PLANNED'::text, 'ACTIVE'::text, 'COMPLETED'::text, 'CANCELLED'::text])))
);


--
-- Name: duty_zone_assignments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.duty_zone_assignments (
    duty_session_id uuid NOT NULL,
    zone_id uuid NOT NULL
);


--
-- Name: evidence_objects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.evidence_objects (
    evidence_id uuid NOT NULL,
    event_id uuid NOT NULL,
    device_id uuid NOT NULL,
    officer_id uuid NOT NULL,
    duty_session_id uuid,
    declared_image_sha256 character(64) NOT NULL,
    manifest_sha256 character(64) NOT NULL,
    manifest jsonb NOT NULL,
    media_type text NOT NULL,
    declared_byte_length integer NOT NULL,
    status text DEFAULT 'AWAITING_UPLOAD'::text NOT NULL,
    received_byte_length integer,
    computed_image_sha256 character(64),
    storage_ref text,
    verification_detail jsonb,
    screen_risk jsonb,
    upload_attempts integer DEFAULT 0 NOT NULL,
    upload_received_at timestamp with time zone,
    verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT evidence_objects_check CHECK (((status <> 'VERIFIED'::text) OR (computed_image_sha256 = declared_image_sha256))),
    CONSTRAINT evidence_objects_declared_byte_length_check CHECK ((declared_byte_length > 0)),
    CONSTRAINT evidence_objects_declared_image_sha256_check CHECK ((declared_image_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT evidence_objects_manifest_sha256_check CHECK ((manifest_sha256 ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT evidence_objects_media_type_check CHECK ((media_type = 'image/jpeg'::text)),
    CONSTRAINT evidence_objects_status_check CHECK ((status = ANY (ARRAY['AWAITING_UPLOAD'::text, 'VERIFIED'::text, 'QUARANTINED'::text])))
);


--
-- Name: geo_zones; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.geo_zones (
    id uuid NOT NULL,
    code text NOT NULL,
    name text NOT NULL,
    zone_type text NOT NULL,
    geom public.geography(MultiPolygon,4326) NOT NULL,
    srid integer DEFAULT 4326 NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    version integer DEFAULT 1 NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_to timestamp with time zone,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT geo_zones_check CHECK (((valid_to IS NULL) OR (valid_to > valid_from))),
    CONSTRAINT geo_zones_code_check CHECK ((code ~ '^[A-Z0-9-]{2,32}$'::text)),
    CONSTRAINT geo_zones_geom_check CHECK (public.st_isvalid((geom)::public.geometry)),
    CONSTRAINT geo_zones_srid_check CHECK ((srid = 4326)),
    CONSTRAINT geo_zones_version_check CHECK ((version > 0)),
    CONSTRAINT geo_zones_zone_type_check CHECK ((zone_type = ANY (ARRAY['STATION'::text, 'PLATFORM'::text, 'YARD'::text, 'TRACK_SECTION'::text, 'OFFICE'::text, 'OTHER'::text])))
);


--
-- Name: ingestion_conflicts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_conflicts (
    id uuid NOT NULL,
    device_id uuid NOT NULL,
    event_id uuid NOT NULL,
    device_sequence_number bigint,
    existing_event_hash character(64) NOT NULL,
    conflicting_event_hash text,
    conflicting_event jsonb NOT NULL,
    batch_id uuid NOT NULL,
    detected_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ingestion_rejections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ingestion_rejections (
    id uuid NOT NULL,
    batch_id uuid NOT NULL,
    device_id uuid NOT NULL,
    event_id_text text,
    device_sequence_number bigint,
    reason_code text NOT NULL,
    detail text NOT NULL,
    submitted_sha256 character(64) NOT NULL,
    submitted_event jsonb,
    request_id text,
    received_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: officers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.officers (
    id uuid NOT NULL,
    employee_ref text NOT NULL,
    display_name text NOT NULL,
    rank text NOT NULL,
    station text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    is_demo boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT officers_display_name_check CHECK (((length(display_name) >= 2) AND (length(display_name) <= 80))),
    CONSTRAINT officers_employee_ref_check CHECK ((employee_ref ~ '^[A-Z0-9-]{3,32}$'::text)),
    CONSTRAINT officers_rank_check CHECK ((rank = ANY (ARRAY['CONSTABLE'::text, 'HEAD_CONSTABLE'::text, 'ASI'::text, 'SI'::text, 'INSPECTOR'::text, 'DSP'::text, 'OTHER'::text]))),
    CONSTRAINT officers_station_check CHECK (((length(station) >= 2) AND (length(station) <= 80)))
);


--
-- Name: patrol_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.patrol_logs (
    id uuid NOT NULL,
    event_id uuid NOT NULL,
    officer_id uuid NOT NULL,
    duty_session_id uuid,
    device_id uuid NOT NULL,
    event_type text NOT NULL,
    location public.geography(Point,4326),
    horizontal_accuracy_m double precision,
    recorded_device_time timestamp with time zone NOT NULL,
    trusted_time_estimate timestamp with time zone,
    server_received_at timestamp with time zone NOT NULL,
    evidence_id uuid,
    verification_status text NOT NULL,
    spatial_result text NOT NULL,
    matched_zone_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    distance_to_assigned_zone_m double precision,
    mock_indicator boolean,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT patrol_logs_horizontal_accuracy_m_check CHECK (((horizontal_accuracy_m IS NULL) OR (horizontal_accuracy_m >= (0)::double precision))),
    CONSTRAINT patrol_logs_spatial_result_check CHECK ((spatial_result = ANY (ARRAY['INSIDE_ASSIGNED_ZONE'::text, 'OUTSIDE_WITHIN_ACCURACY'::text, 'OUTSIDE_ASSIGNED_ZONE'::text, 'NO_ASSIGNED_ZONE'::text, 'NO_LOCATION'::text]))),
    CONSTRAINT patrol_logs_verification_status_check CHECK ((verification_status = ANY (ARRAY['SIGNATURE_VALID'::text, 'EVIDENCE_PENDING'::text, 'EVIDENCE_VERIFIED'::text, 'EVIDENCE_QUARANTINED'::text])))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.refresh_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    family_id uuid NOT NULL,
    token_hash character(64) NOT NULL,
    device_id uuid,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    used_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoke_reason text,
    CONSTRAINT refresh_tokens_check CHECK ((expires_at > issued_at))
);


--
-- Name: retention_policies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.retention_policies (
    category text NOT NULL,
    retain_days integer NOT NULL,
    description text NOT NULL,
    CONSTRAINT retention_policies_retain_days_check CHECK (((retain_days >= 1) AND (retain_days <= 3650)))
);


--
-- Name: review_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.review_flags (
    id uuid NOT NULL,
    flag_type text NOT NULL,
    severity text NOT NULL,
    status text DEFAULT 'OPEN'::text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    officer_id uuid,
    device_id uuid,
    duty_session_id uuid,
    event_id uuid,
    evidence_id uuid,
    inputs jsonb DEFAULT '{}'::jsonb NOT NULL,
    dedupe_key text NOT NULL,
    assigned_to uuid,
    acknowledged_by uuid,
    acknowledged_at timestamp with time zone,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT review_flags_flag_type_check CHECK ((flag_type = ANY (ARRAY['CHECKIN_MISSED'::text, 'CHECKIN_LATE'::text, 'CLOCK_ANOMALY'::text, 'MOCK_LOCATION_INDICATOR'::text, 'EVIDENCE_HASH_MISMATCH'::text, 'INVALID_DEVICE_SIGNATURE'::text, 'SEQUENCE_GAP'::text, 'CHAIN_LINK_MISMATCH'::text, 'EVENT_CONFLICT'::text, 'SPATIAL_ZONE_EXCEPTION'::text, 'MOVEMENT_INCONSISTENCY'::text, 'DEVICE_REGISTRATION'::text, 'DEVICE_REVOCATION'::text, 'DEVICE_INTEGRITY'::text, 'SCREEN_RECAPTURE_RISK'::text]))),
    CONSTRAINT review_flags_resolution_note_check CHECK ((length(resolution_note) <= 1000)),
    CONSTRAINT review_flags_severity_check CHECK ((severity = ANY (ARRAY['INFO'::text, 'LOW'::text, 'MEDIUM'::text, 'HIGH'::text]))),
    CONSTRAINT review_flags_status_check CHECK ((status = ANY (ARRAY['OPEN'::text, 'ACKNOWLEDGED'::text, 'ASSIGNED'::text, 'RESOLVED'::text, 'DISMISSED'::text])))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version text NOT NULL,
    name text NOT NULL,
    checksum character(64) NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: sync_batches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sync_batches (
    batch_id uuid NOT NULL,
    device_id uuid NOT NULL,
    request_sha256 character(64) NOT NULL,
    received_at timestamp with time zone DEFAULT now() NOT NULL,
    processed_at timestamp with time zone,
    event_count integer NOT NULL,
    accepted_count integer DEFAULT 0 NOT NULL,
    duplicate_count integer DEFAULT 0 NOT NULL,
    rejected_count integer DEFAULT 0 NOT NULL,
    response_json jsonb,
    request_id text,
    CONSTRAINT sync_batches_event_count_check CHECK ((event_count > 0))
);


--
-- Name: app_users app_users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_email_key UNIQUE (email);


--
-- Name: app_users app_users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_pkey PRIMARY KEY (id);


--
-- Name: audit_chain_head audit_chain_head_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_chain_head
    ADD CONSTRAINT audit_chain_head_pkey PRIMARY KEY (id);


--
-- Name: audit_events audit_events_audit_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_audit_id_key UNIQUE (audit_id);


--
-- Name: audit_events audit_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_pkey PRIMARY KEY (sequence);


--
-- Name: audit_events audit_events_record_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_record_hash_key UNIQUE (record_hash);


--
-- Name: checkins checkins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_pkey PRIMARY KEY (checkin_id);


--
-- Name: device_chain_heads device_chain_heads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_chain_heads
    ADD CONSTRAINT device_chain_heads_pkey PRIMARY KEY (device_id);


--
-- Name: device_events device_events_device_id_device_sequence_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_device_id_device_sequence_number_key UNIQUE (device_id, device_sequence_number);


--
-- Name: device_events device_events_event_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_event_hash_key UNIQUE (event_hash);


--
-- Name: device_events device_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_pkey PRIMARY KEY (event_id);


--
-- Name: devices devices_key_fingerprint_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_key_fingerprint_key UNIQUE (key_fingerprint);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: duty_sessions duty_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duty_sessions
    ADD CONSTRAINT duty_sessions_pkey PRIMARY KEY (id);


--
-- Name: duty_zone_assignments duty_zone_assignments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duty_zone_assignments
    ADD CONSTRAINT duty_zone_assignments_pkey PRIMARY KEY (duty_session_id, zone_id);


--
-- Name: evidence_objects evidence_objects_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_objects
    ADD CONSTRAINT evidence_objects_event_id_key UNIQUE (event_id);


--
-- Name: evidence_objects evidence_objects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_objects
    ADD CONSTRAINT evidence_objects_pkey PRIMARY KEY (evidence_id);


--
-- Name: geo_zones geo_zones_code_version_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_zones
    ADD CONSTRAINT geo_zones_code_version_key UNIQUE (code, version);


--
-- Name: geo_zones geo_zones_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.geo_zones
    ADD CONSTRAINT geo_zones_pkey PRIMARY KEY (id);


--
-- Name: ingestion_conflicts ingestion_conflicts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_conflicts
    ADD CONSTRAINT ingestion_conflicts_pkey PRIMARY KEY (id);


--
-- Name: ingestion_rejections ingestion_rejections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_rejections
    ADD CONSTRAINT ingestion_rejections_pkey PRIMARY KEY (id);


--
-- Name: officers officers_employee_ref_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.officers
    ADD CONSTRAINT officers_employee_ref_key UNIQUE (employee_ref);


--
-- Name: officers officers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.officers
    ADD CONSTRAINT officers_pkey PRIMARY KEY (id);


--
-- Name: patrol_logs patrol_logs_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patrol_logs
    ADD CONSTRAINT patrol_logs_event_id_key UNIQUE (event_id);


--
-- Name: patrol_logs patrol_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patrol_logs
    ADD CONSTRAINT patrol_logs_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_hash_key UNIQUE (token_hash);


--
-- Name: retention_policies retention_policies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.retention_policies
    ADD CONSTRAINT retention_policies_pkey PRIMARY KEY (category);


--
-- Name: review_flags review_flags_dedupe_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_dedupe_key_key UNIQUE (dedupe_key);


--
-- Name: review_flags review_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sync_batches sync_batches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_batches
    ADD CONSTRAINT sync_batches_pkey PRIMARY KEY (batch_id);


--
-- Name: audit_events_action_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_action_idx ON public.audit_events USING btree (action, sequence DESC);


--
-- Name: audit_events_actor_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_actor_idx ON public.audit_events USING btree (actor_user_id, sequence DESC);


--
-- Name: audit_events_evidence_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_events_evidence_idx ON public.audit_events USING btree (evidence_id, sequence);


--
-- Name: checkins_officer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkins_officer_idx ON public.checkins USING btree (officer_id, scheduled_for DESC);


--
-- Name: checkins_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX checkins_status_idx ON public.checkins USING btree (status);


--
-- Name: device_events_officer_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_events_officer_time_idx ON public.device_events USING btree (officer_id, device_wall_time DESC);


--
-- Name: device_events_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_events_session_idx ON public.device_events USING btree (duty_session_id, device_sequence_number);


--
-- Name: device_events_type_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX device_events_type_idx ON public.device_events USING btree (event_type, server_received_at DESC);


--
-- Name: devices_officer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX devices_officer_idx ON public.devices USING btree (officer_id);


--
-- Name: duty_sessions_officer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX duty_sessions_officer_idx ON public.duty_sessions USING btree (officer_id, planned_start DESC);


--
-- Name: evidence_objects_officer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evidence_objects_officer_idx ON public.evidence_objects USING btree (officer_id, created_at DESC);


--
-- Name: evidence_objects_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX evidence_objects_status_idx ON public.evidence_objects USING btree (status);


--
-- Name: geo_zones_geom_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX geo_zones_geom_gist ON public.geo_zones USING gist (geom);


--
-- Name: ingestion_conflicts_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ingestion_conflicts_device_idx ON public.ingestion_conflicts USING btree (device_id, detected_at DESC);


--
-- Name: ingestion_rejections_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ingestion_rejections_device_idx ON public.ingestion_rejections USING btree (device_id, received_at DESC);


--
-- Name: patrol_logs_location_gist; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patrol_logs_location_gist ON public.patrol_logs USING gist (location);


--
-- Name: patrol_logs_officer_time_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patrol_logs_officer_time_idx ON public.patrol_logs USING btree (officer_id, recorded_device_time DESC);


--
-- Name: patrol_logs_received_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patrol_logs_received_idx ON public.patrol_logs USING btree (server_received_at DESC);


--
-- Name: patrol_logs_session_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX patrol_logs_session_idx ON public.patrol_logs USING btree (duty_session_id, recorded_device_time);


--
-- Name: refresh_tokens_family_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refresh_tokens_family_idx ON public.refresh_tokens USING btree (family_id);


--
-- Name: refresh_tokens_user_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX refresh_tokens_user_idx ON public.refresh_tokens USING btree (user_id);


--
-- Name: review_flags_officer_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_flags_officer_idx ON public.review_flags USING btree (officer_id, created_at DESC);


--
-- Name: review_flags_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX review_flags_status_idx ON public.review_flags USING btree (status, created_at DESC);


--
-- Name: sync_batches_device_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX sync_batches_device_idx ON public.sync_batches USING btree (device_id, received_at DESC);


--
-- Name: app_users app_users_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER app_users_touch BEFORE UPDATE ON public.app_users FOR EACH ROW EXECUTE FUNCTION public.pramaan_touch_updated_at();


--
-- Name: audit_events audit_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_append_only BEFORE DELETE OR UPDATE ON public.audit_events FOR EACH ROW EXECUTE FUNCTION public.pramaan_append_only();


--
-- Name: audit_events audit_events_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER audit_events_no_truncate BEFORE TRUNCATE ON public.audit_events FOR EACH STATEMENT EXECUTE FUNCTION public.pramaan_append_only();


--
-- Name: device_events device_events_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER device_events_append_only BEFORE DELETE OR UPDATE ON public.device_events FOR EACH ROW EXECUTE FUNCTION public.pramaan_append_only();


--
-- Name: device_events device_events_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER device_events_no_truncate BEFORE TRUNCATE ON public.device_events FOR EACH STATEMENT EXECUTE FUNCTION public.pramaan_append_only();


--
-- Name: duty_sessions duty_sessions_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER duty_sessions_touch BEFORE UPDATE ON public.duty_sessions FOR EACH ROW EXECUTE FUNCTION public.pramaan_touch_updated_at();


--
-- Name: evidence_objects evidence_objects_guard; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER evidence_objects_guard BEFORE DELETE OR UPDATE ON public.evidence_objects FOR EACH ROW EXECUTE FUNCTION public.pramaan_evidence_guard();


--
-- Name: ingestion_conflicts ingestion_conflicts_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingestion_conflicts_append_only BEFORE DELETE OR UPDATE ON public.ingestion_conflicts FOR EACH ROW EXECUTE FUNCTION public.pramaan_append_only();


--
-- Name: ingestion_conflicts ingestion_conflicts_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingestion_conflicts_no_truncate BEFORE TRUNCATE ON public.ingestion_conflicts FOR EACH STATEMENT EXECUTE FUNCTION public.pramaan_append_only();


--
-- Name: ingestion_rejections ingestion_rejections_append_only; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingestion_rejections_append_only BEFORE DELETE OR UPDATE ON public.ingestion_rejections FOR EACH ROW EXECUTE FUNCTION public.pramaan_append_only();


--
-- Name: ingestion_rejections ingestion_rejections_no_truncate; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER ingestion_rejections_no_truncate BEFORE TRUNCATE ON public.ingestion_rejections FOR EACH STATEMENT EXECUTE FUNCTION public.pramaan_append_only();


--
-- Name: officers officers_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER officers_touch BEFORE UPDATE ON public.officers FOR EACH ROW EXECUTE FUNCTION public.pramaan_touch_updated_at();


--
-- Name: review_flags review_flags_touch; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER review_flags_touch BEFORE UPDATE ON public.review_flags FOR EACH ROW EXECUTE FUNCTION public.pramaan_touch_updated_at();


--
-- Name: app_users app_users_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.app_users
    ADD CONSTRAINT app_users_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.officers(id);


--
-- Name: audit_events audit_events_actor_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_events
    ADD CONSTRAINT audit_events_actor_user_id_fkey FOREIGN KEY (actor_user_id) REFERENCES public.app_users(id);


--
-- Name: checkins checkins_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: checkins checkins_duty_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_duty_session_id_fkey FOREIGN KEY (duty_session_id) REFERENCES public.duty_sessions(id);


--
-- Name: checkins checkins_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.checkins
    ADD CONSTRAINT checkins_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.officers(id);


--
-- Name: device_chain_heads device_chain_heads_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_chain_heads
    ADD CONSTRAINT device_chain_heads_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: device_events device_events_batch_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_batch_id_fkey FOREIGN KEY (batch_id) REFERENCES public.sync_batches(batch_id);


--
-- Name: device_events device_events_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: device_events device_events_duty_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_duty_session_id_fkey FOREIGN KEY (duty_session_id) REFERENCES public.duty_sessions(id);


--
-- Name: device_events device_events_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.device_events
    ADD CONSTRAINT device_events_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.officers(id);


--
-- Name: devices devices_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.app_users(id);


--
-- Name: devices devices_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.officers(id);


--
-- Name: devices devices_revoked_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.devices
    ADD CONSTRAINT devices_revoked_by_fkey FOREIGN KEY (revoked_by) REFERENCES public.app_users(id);


--
-- Name: duty_sessions duty_sessions_authorized_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duty_sessions
    ADD CONSTRAINT duty_sessions_authorized_by_fkey FOREIGN KEY (authorized_by) REFERENCES public.app_users(id);


--
-- Name: duty_sessions duty_sessions_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duty_sessions
    ADD CONSTRAINT duty_sessions_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: duty_sessions duty_sessions_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duty_sessions
    ADD CONSTRAINT duty_sessions_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.officers(id);


--
-- Name: duty_zone_assignments duty_zone_assignments_duty_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duty_zone_assignments
    ADD CONSTRAINT duty_zone_assignments_duty_session_id_fkey FOREIGN KEY (duty_session_id) REFERENCES public.duty_sessions(id) ON DELETE CASCADE;


--
-- Name: duty_zone_assignments duty_zone_assignments_zone_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.duty_zone_assignments
    ADD CONSTRAINT duty_zone_assignments_zone_id_fkey FOREIGN KEY (zone_id) REFERENCES public.geo_zones(id);


--
-- Name: evidence_objects evidence_objects_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_objects
    ADD CONSTRAINT evidence_objects_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: evidence_objects evidence_objects_duty_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_objects
    ADD CONSTRAINT evidence_objects_duty_session_id_fkey FOREIGN KEY (duty_session_id) REFERENCES public.duty_sessions(id);


--
-- Name: evidence_objects evidence_objects_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_objects
    ADD CONSTRAINT evidence_objects_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.device_events(event_id);


--
-- Name: evidence_objects evidence_objects_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.evidence_objects
    ADD CONSTRAINT evidence_objects_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.officers(id);


--
-- Name: ingestion_conflicts ingestion_conflicts_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_conflicts
    ADD CONSTRAINT ingestion_conflicts_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: ingestion_rejections ingestion_rejections_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ingestion_rejections
    ADD CONSTRAINT ingestion_rejections_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: patrol_logs patrol_logs_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patrol_logs
    ADD CONSTRAINT patrol_logs_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: patrol_logs patrol_logs_duty_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patrol_logs
    ADD CONSTRAINT patrol_logs_duty_session_id_fkey FOREIGN KEY (duty_session_id) REFERENCES public.duty_sessions(id);


--
-- Name: patrol_logs patrol_logs_event_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patrol_logs
    ADD CONSTRAINT patrol_logs_event_id_fkey FOREIGN KEY (event_id) REFERENCES public.device_events(event_id);


--
-- Name: patrol_logs patrol_logs_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.patrol_logs
    ADD CONSTRAINT patrol_logs_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.officers(id);


--
-- Name: refresh_tokens refresh_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.refresh_tokens
    ADD CONSTRAINT refresh_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.app_users(id) ON DELETE CASCADE;


--
-- Name: review_flags review_flags_acknowledged_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_acknowledged_by_fkey FOREIGN KEY (acknowledged_by) REFERENCES public.app_users(id);


--
-- Name: review_flags review_flags_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.app_users(id);


--
-- Name: review_flags review_flags_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- Name: review_flags review_flags_duty_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_duty_session_id_fkey FOREIGN KEY (duty_session_id) REFERENCES public.duty_sessions(id);


--
-- Name: review_flags review_flags_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.officers(id);


--
-- Name: review_flags review_flags_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.review_flags
    ADD CONSTRAINT review_flags_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.app_users(id);


--
-- Name: sync_batches sync_batches_device_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sync_batches
    ADD CONSTRAINT sync_batches_device_id_fkey FOREIGN KEY (device_id) REFERENCES public.devices(id);


--
-- PostgreSQL database dump complete
--

\unrestrict PqezK7lEn8OKLcAgPoQ2uYu9jO0tsmMOafvubriUF2dYQ473Y8dnLD6VOPmk4Ja

