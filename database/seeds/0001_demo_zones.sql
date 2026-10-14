-- FICTIONAL / ILLUSTRATIVE demonstration zones near Guntur, Andhra Pradesh.
-- Geometry is approximate and NOT surveyed. Do not use for operational decisions.
-- Zones are valid from 2026-01-01 so that delayed (offline) observations recorded before the
-- seed ran are still evaluated against them (spatial checks use the observation time).
-- Coordinates: WGS84, ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326).
INSERT INTO geo_zones (id, code, name, zone_type, geom, is_demo, valid_from) VALUES
 ('a0000000-0000-4000-8000-000000000001', 'DEMO-GNT-PF1', 'DEMO Guntur Platform 1 (illustrative)', 'PLATFORM',
   ST_Multi(ST_MakeEnvelope(80.4490, 16.3002, 80.4520, 16.3006, 4326))::geography, true, '2026-01-01T00:00:00Z'),
 ('a0000000-0000-4000-8000-000000000002', 'DEMO-GNT-CONC', 'DEMO Guntur Concourse (illustrative)', 'STATION',
   ST_Multi(ST_MakeEnvelope(80.4495, 16.2995, 80.4515, 16.3002, 4326))::geography, true, '2026-01-01T00:00:00Z'),
 ('a0000000-0000-4000-8000-000000000003', 'DEMO-GNT-YARD', 'DEMO Goods Yard (illustrative)', 'YARD',
   ST_Multi(ST_MakeEnvelope(80.4530, 16.3010, 80.4580, 16.3030, 4326))::geography, true, '2026-01-01T00:00:00Z'),
 ('a0000000-0000-4000-8000-000000000004', 'DEMO-GNT-SEC1', 'DEMO Track Section West (illustrative)', 'TRACK_SECTION',
   ST_Multi(ST_MakeEnvelope(80.4400, 16.3004, 80.4490, 16.3010, 4326))::geography, true, '2026-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;
