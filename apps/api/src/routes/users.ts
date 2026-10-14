import { Router } from 'express';
import type { AppContext } from '../context.js';
import { h, requireRole } from '../middleware/auth.js';

export function userRoutes(ctx: AppContext): Router {
  const r = Router();
  /** Minimal list of dashboard reviewers for flag assignment (no credentials, no e-mail). */
  r.get(
    '/reviewers',
    requireRole('ADMIN', 'SUPERVISOR'),
    h(async (_req, res) => {
      const { rows } = await ctx.pool.query(
        `SELECT id, display_name AS "displayName", role FROM app_users WHERE is_active AND role IN ('ADMIN','SUPERVISOR','REVIEWER') ORDER BY display_name LIMIT 200`,
      );
      res.json({ items: rows });
    }),
  );
  return r;
}
