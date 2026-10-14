import { Router, type Request, type Response } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { authUser, h, requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import {
  familyOfRefreshToken,
  login,
  refresh,
  revokeFamily,
  type SessionTokens,
} from '../services/auth.js';
import { uuidParam } from './common.js';

const REFRESH_COOKIE = 'pramaan_rt';

const loginSchema = z
  .object({
    email: z.string().email().max(120),
    password: z.string().min(1).max(256),
    client: z.enum(['web', 'mobile']).default('web'),
    deviceId: uuidParam.nullable().optional(),
  })
  .strict();

export function authRoutes(ctx: AppContext): Router {
  const r = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: ctx.env.RATE_LIMIT_LOGIN_PER_15MIN,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: (req) =>
      `${ipKeyGenerator(req.ip ?? 'unknown')}|${String(
        (req.body as { email?: string })?.email ?? '',
      )
        .toLowerCase()
        .slice(0, 120)}`,
    handler: (req, res) =>
      res.status(429).json({
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many login attempts. Try again later.',
          requestId: reqId(req),
        },
      }),
  });

  const cookieOpts = {
    httpOnly: true,
    secure: ctx.env.cookieSecure,
    sameSite: ctx.env.COOKIE_SAMESITE,
    path: '/api/v1/auth',
    maxAge: ctx.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000,
  } as const;

  function respond(res: Response, s: SessionTokens, client: 'web' | 'mobile') {
    res.setHeader('Cache-Control', 'no-store');
    if (client === 'web') {
      res.cookie(REFRESH_COOKIE, s.refreshToken, cookieOpts);
      res.json({
        accessToken: s.accessToken,
        accessTokenExpiresAt: s.accessTokenExpiresAt,
        user: s.user,
      });
    } else {
      res.json(s);
    }
  }

  /** Cookie-based refresh requires a custom header (forces a CORS pre-flight → CSRF protection). */
  function presentedRefresh(req: Request): { token: string; client: 'web' | 'mobile' } {
    const body = (req.body ?? {}) as { refreshToken?: unknown };
    if (
      typeof body.refreshToken === 'string' &&
      body.refreshToken.length >= 20 &&
      body.refreshToken.length <= 100
    )
      return { token: body.refreshToken, client: 'mobile' };
    const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
    if (cookie) {
      if (req.header('x-pramaan-csrf') !== '1')
        throw new AppError(403, 'FORBIDDEN', 'Missing anti-CSRF header.');
      return { token: cookie, client: 'web' };
    }
    throw new AppError(401, 'AUTHENTICATION_REQUIRED', 'No refresh token supplied.');
  }

  r.post(
    '/login',
    loginLimiter,
    h(async (req, res) => {
      const body = loginSchema.parse(req.body);
      const s = await login(
        ctx,
        {
          email: body.email,
          password: body.password,
          client: body.client,
          deviceId: body.deviceId ?? null,
        },
        reqId(req),
      );
      respond(res, s, body.client);
    }),
  );

  r.post(
    '/refresh',
    h(async (req, res) => {
      const p = presentedRefresh(req);
      try {
        respond(res, await refresh(ctx, p.token, reqId(req)), p.client);
      } catch (e) {
        if (p.client === 'web')
          res.clearCookie(REFRESH_COOKIE, { ...cookieOpts, maxAge: undefined });
        throw e;
      }
    }),
  );

  r.post(
    '/logout',
    requireAuth(ctx),
    h(async (req, res) => {
      const u = authUser(req);
      await revokeFamily(ctx, u.family, u.id, u.role, reqId(req));
      const cookie = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE];
      if (cookie) {
        const fam = await familyOfRefreshToken(ctx, cookie);
        if (fam && fam !== u.family) await revokeFamily(ctx, fam, u.id, u.role, reqId(req));
      }
      res.clearCookie(REFRESH_COOKIE, { ...cookieOpts, maxAge: undefined });
      res.status(204).end();
    }),
  );

  r.get(
    '/me',
    requireAuth(ctx),
    h(async (req, res) => {
      const u = authUser(req);
      const row = (
        await ctx.pool.query(
          'SELECT id, email, display_name AS "displayName", role, officer_id AS "officerId", is_demo AS "isDemo" FROM app_users WHERE id = $1',
          [u.id],
        )
      ).rows[0];
      res.json({ user: row });
    }),
  );
  return r;
}
