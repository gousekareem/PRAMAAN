import { Router } from 'express';
import type { AppContext } from '../context.js';
import { h, requireAnyPermission } from '../middleware/auth.js';

export function zoneRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    requireAnyPermission('duty.view', 'map.view'),
    h(async (_req, res) => {
      const { rows } = await ctx.pool.query(
        `SELECT id, code, name, zone_type AS "zoneType", version, is_demo AS "isDemo", ST_AsGeoJSON(geom, 7)::json AS geometry
         FROM geo_zones WHERE is_active AND (valid_to IS NULL OR valid_to > now()) ORDER BY code LIMIT 500`,
      );
      res.json({
        type: 'FeatureCollection',
        features: rows.map(({ geometry, ...props }) => ({
          type: 'Feature',
          geometry,
          properties: props,
        })),
      });
    }),
  );
  return r;
}
