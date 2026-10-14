import type pg from 'pg';

/** Geometry precision allowance for demo polygons (they are not surveyed). */
export const BOUNDARY_TOLERANCE_M = 5;

export type SpatialResult =
  | 'INSIDE_ASSIGNED_ZONE'
  | 'OUTSIDE_WITHIN_ACCURACY'
  | 'OUTSIDE_ASSIGNED_ZONE'
  | 'NO_ASSIGNED_ZONE'
  | 'NO_LOCATION';

export interface SpatialEvaluation {
  spatialResult: SpatialResult;
  matchedZoneIds: string[];
  distanceToAssignedZoneM: number | null;
}

/**
 * Classifies an observation against the duty's assigned zones with PostGIS.
 * Points are built as ST_MakePoint(longitude, latitude) — PostGIS uses (x=lon, y=lat).
 * A point just outside a polygon but within the reported GPS accuracy is NOT treated as an
 * exception, and an exception is a review flag, never proof of misconduct.
 */
export async function evaluateLocation(
  db: pg.PoolClient | pg.Pool,
  longitude: number,
  latitude: number,
  accuracyM: number | null,
  dutySessionId: string | null,
  at: Date = new Date(),
): Promise<SpatialEvaluation> {
  const { rows } = await db.query<{ id: string; covers: boolean; dist: number; assigned: boolean }>(
    `WITH p AS (SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography AS g),
          assigned AS (SELECT zone_id FROM duty_zone_assignments WHERE duty_session_id = $3)
     SELECT z.id, ST_Covers(z.geom, p.g) AS covers, ST_Distance(z.geom, p.g) AS dist,
            (z.id IN (SELECT zone_id FROM assigned)) AS assigned
       FROM geo_zones z, p
      WHERE z.is_active AND z.valid_from <= $4 AND (z.valid_to IS NULL OR z.valid_to > $4)
        AND (ST_DWithin(z.geom, p.g, 20000) OR z.id IN (SELECT zone_id FROM assigned))`,
    [longitude, latitude, dutySessionId, at],
  );
  const matchedZoneIds = rows.filter((r) => r.covers).map((r) => r.id);
  const assigned = rows.filter((r) => r.assigned);
  if (!assigned.length)
    return { spatialResult: 'NO_ASSIGNED_ZONE', matchedZoneIds, distanceToAssignedZoneM: null };
  const minDist = Math.min(...assigned.map((r) => Number(r.dist)));
  if (assigned.some((r) => r.covers))
    return { spatialResult: 'INSIDE_ASSIGNED_ZONE', matchedZoneIds, distanceToAssignedZoneM: 0 };
  const allowance = (accuracyM ?? 0) + BOUNDARY_TOLERANCE_M;
  return {
    spatialResult: minDist <= allowance ? 'OUTSIDE_WITHIN_ACCURACY' : 'OUTSIDE_ASSIGNED_ZONE',
    matchedZoneIds,
    distanceToAssignedZoneM: Math.round(minDist * 10) / 10,
  };
}

/** Geodesic distance (metres) between two stored patrol observations. */
export async function distanceBetweenLogs(
  db: pg.PoolClient | pg.Pool,
  a: string,
  b: string,
): Promise<number | null> {
  const { rows } = await db.query<{ d: number | null }>(
    `SELECT ST_Distance(x.location, y.location) AS d FROM patrol_logs x, patrol_logs y WHERE x.event_id = $1 AND y.event_id = $2`,
    [a, b],
  );
  return rows[0]?.d ?? null;
}
