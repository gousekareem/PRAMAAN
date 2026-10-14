import { Router } from 'express';
import type { AppContext } from '../context.js';

export function healthRoutes(ctx: AppContext): Router {
  const r = Router();
  /** Liveness: process is up. Does not touch the database. */
  r.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'pramaan-api', time: new Date().toISOString() });
  });
  /** Readiness: database reachable, PostGIS present, migrations applied, storage writable. */
  r.get('/ready', async (_req, res) => {
    const checks: Record<string, string> = {};
    let ok = true;
    try {
      const { rows } = await ctx.pool.query<{ v: string; m: number }>(
        'SELECT postgis_lib_version() AS v, (SELECT count(*)::int FROM schema_migrations) AS m',
      );
      checks.database = 'ok';
      checks.postgis = rows[0]?.v ?? 'missing';
      checks.migrations = String(rows[0]?.m ?? 0);
    } catch {
      ok = false;
      checks.database = 'unavailable';
    }
    try {
      const { path, stream } = ctx.storage.createTemp();
      await new Promise<void>((resolve, reject) =>
        stream.end('ok', () => resolve()).on('error', reject),
      );
      await ctx.storage.discard(path);
      checks.storage = 'ok';
    } catch {
      ok = false;
      checks.storage = 'unwritable';
    }
    res.status(ok ? 200 : 503).json({ status: ok ? 'ready' : 'not-ready', checks });
  });
  r.get('/api/v1/time', (_req, res) => res.json({ serverTime: new Date().toISOString() }));
  return r;
}
