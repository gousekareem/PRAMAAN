import { Router } from 'express';
import type { AppContext } from '../context.js';
import { h, requirePermission } from '../middleware/auth.js';

export function userRoutes(ctx: AppContext): Router {
  const r = Router();
  /** Minimal list of dashboard reviewers for flag assignment (no credentials, no e-mail). */
  r.get(
    '/reviewers',
    requirePermission('exception.manage'),
    h(async (_req, res) => {
      const { rows } = await ctx.pool.query(
        `SELECT u.id, u.display_name AS "displayName", u.role FROM app_users u
          WHERE u.is_active AND EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_code = u.role AND rp.permission_code = 'exception.view')
          ORDER BY u.display_name LIMIT 200`,
      );
      res.json({ items: rows });
    }),
  );
  return r;
}
