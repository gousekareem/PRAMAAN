import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AppContext } from '../context.js';
import type { Role } from '../security/tokens.js';
import { AppError } from './errors.js';

export interface AuthUser {
  id: string;
  role: Role;
  officerId: string | null;
  family: string;
}

export function authUser(req: Request): AuthUser {
  const u = (req as { user?: AuthUser }).user;
  if (!u) throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required.');
  return u;
}

/**
 * Verifies the Bearer access token and re-checks on every request that the user is still
 * active and that the token family has not been revoked (logout / reuse detection).
 */
export function requireAuth(ctx: AppContext): RequestHandler {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const header = req.header('authorization');
      if (!header?.startsWith('Bearer '))
        throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'Authentication required.');
      const claims = await ctx.tokens.verifyAccess(header.slice(7).trim());
      const { rows } = await ctx.pool.query<{ is_active: boolean; revoked: boolean }>(
        `SELECT u.is_active,
                EXISTS (SELECT 1 FROM refresh_tokens t WHERE t.family_id = $2 AND t.revoked_at IS NOT NULL) AS revoked
           FROM app_users u WHERE u.id = $1`,
        [claims.sub, claims.fam],
      );
      const row = rows[0];
      if (!row || !row.is_active || row.revoked)
        throw new AppError(401, 'TOKEN_INVALID', 'Session is no longer valid.');
      (req as { user?: AuthUser }).user = {
        id: claims.sub,
        role: claims.role,
        officerId: claims.oid,
        family: claims.fam,
      };
      next();
    } catch (e) {
      next(e);
    }
  };
}

export function requireRole(...roles: Role[]): RequestHandler {
  return (req, _res, next) => {
    try {
      const u = authUser(req);
      if (!roles.includes(u.role))
        throw new AppError(403, 'FORBIDDEN', 'You are not authorised to perform this action.');
      next();
    } catch (e) {
      next(e);
    }
  };
}

/** Wraps async route handlers so rejections reach the error handler. */
export function h(fn: (req: Request, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    fn(req, res).catch(next);
  };
}
