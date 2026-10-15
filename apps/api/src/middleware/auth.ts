import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppContext } from '../context.js';
import type { Role } from '../security/tokens.js';
import { AppError } from './errors.js';

export type ScopeLevel = 'SELF' | 'UNIT' | 'UNIT_TREE' | 'ALL';

export interface AccessScope {
  level: ScopeLevel;
  /** Units the user may see; null means no unit restriction (ALL). Empty array means nothing. */
  unitIds: string[] | null;
  officerId: string | null;
}

export interface AuthUser {
  id: string;
  role: Role;
  officerId: string | null;
  family: string;
  /** Permission codes re-read from the database on every request (never from the token). */
  permissions: ReadonlySet<string>;
  scope: AccessScope;
}

export function authUser(req: Request): AuthUser {
  const u = (req as { user?: AuthUser }).user;
  if (!u) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required.');
  return u;
}

export function can(u: AuthUser, permission: string): boolean {
  return u.permissions.has(permission);
}

interface AccessRow {
  is_active: boolean;
  role: string;
  officer_id: string | null;
  officer_active: boolean | null;
  unit_id: string | null;
  scope_level: ScopeLevel;
  revoked: boolean;
  permissions: string[];
}

/** Loads role, permission set and data scope for a user from the database. */
export async function loadAccess(
  ctx: Pick<AppContext, 'pool'>,
  userId: string,
  family: string | null,
): Promise<AccessRow | undefined> {
  const { rows } = await ctx.pool.query<AccessRow>(
    `SELECT u.is_active, u.role, u.officer_id, o.is_active AS officer_active, o.unit_id, r.scope_level,
            ($2::uuid IS NOT NULL AND EXISTS (SELECT 1 FROM refresh_tokens t WHERE t.family_id = $2::uuid AND t.revoked_at IS NOT NULL)) AS revoked,
            COALESCE((SELECT array_agg(rp.permission_code ORDER BY rp.permission_code) FROM role_permissions rp WHERE rp.role_code = u.role), '{}') AS permissions
       FROM app_users u JOIN roles r ON r.code = u.role LEFT JOIN officers o ON o.id = u.officer_id
      WHERE u.id = $1`,
    [userId, family],
  );
  return rows[0];
}

export async function resolveScope(
  ctx: Pick<AppContext, 'pool'>,
  level: ScopeLevel,
  unitId: string | null,
  officerId: string | null,
): Promise<AccessScope> {
  if (level === 'ALL') return { level, unitIds: null, officerId };
  if (level === 'SELF') return { level, unitIds: [], officerId };
  if (!unitId) return { level, unitIds: [], officerId };
  if (level === 'UNIT') return { level, unitIds: [unitId], officerId };
  const { rows } = await ctx.pool.query<{ id: string }>(
    `WITH RECURSIVE t AS (SELECT id FROM units WHERE id = $1 UNION SELECT c.id FROM units c JOIN t ON c.parent_id = t.id)
     SELECT id FROM t`,
    [unitId],
  );
  return { level, unitIds: rows.map((r) => r.id), officerId };
}

/**
 * Verifies the Bearer access token and re-checks on every request that the user (and linked
 * personnel record) is still active and that the token family has not been revoked. The role,
 * permissions and scope are loaded from the database, so a stale or edited claim grants nothing.
 */
export function requireAuth(ctx: AppContext): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.header('authorization');
      if (!header?.startsWith('Bearer '))
        throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required.');
      const claims = await ctx.tokens.verifyAccess(header.slice(7).trim());
      const row = await loadAccess(ctx, claims.sub, claims.fam);
      if (!row || !row.is_active || row.revoked || row.officer_active === false)
        throw new AppError(401, 'TOKEN_INVALID', 'Session is no longer valid.');
      (req as { user?: AuthUser }).user = {
        id: claims.sub,
        role: row.role,
        officerId: row.officer_id,
        family: claims.fam,
        permissions: new Set(row.permissions),
        scope: await resolveScope(ctx, row.scope_level, row.unit_id, row.officer_id),
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Requires ALL listed permissions. */
export function requirePermission(...perms: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const u = authUser(req);
      if (!perms.every((p) => u.permissions.has(p)))
        throw new AppError(403, 'FORBIDDEN', 'You are not authorised to perform this action.');
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Requires at least ONE of the listed permissions. */
export function requireAnyPermission(...perms: string[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const u = authUser(req);
      if (!perms.some((p) => u.permissions.has(p)))
        throw new AppError(403, 'FORBIDDEN', 'You are not authorised to perform this action.');
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function assertPermission(u: AuthUser, perm: string): void {
  if (!u.permissions.has(perm))
    throw new AppError(403, 'FORBIDDEN', 'You are not authorised to perform this action.');
}

/** Wraps async route handlers so rejections reach the error handler. */
export function h(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
