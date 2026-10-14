import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { AppError } from '../middleware/errors.js';
import { DUMMY_HASH_PROMISE, verifyPassword } from '../security/passwords.js';
import { newRefreshToken, sha256, type Role } from '../security/tokens.js';
import { appendAudit } from './audit.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: {
    id: string;
    email: string;
    displayName: string;
    role: Role;
    officerId: string | null;
    isDemo: boolean;
  };
}

interface UserRow {
  id: string;
  email: string;
  display_name: string;
  role: Role;
  password_hash: string;
  officer_id: string | null;
  is_active: boolean;
  is_demo: boolean;
  failed_login_count: number;
  locked_until: Date | null;
}

async function issueSession(
  ctx: AppContext,
  c: pg.PoolClient,
  u: UserRow,
  family: string,
  deviceId: string | null,
): Promise<SessionTokens> {
  const { token, hash } = newRefreshToken();
  const refreshExpires = new Date(Date.now() + ctx.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
  await c.query(
    'INSERT INTO refresh_tokens (id, user_id, family_id, token_hash, device_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6)',
    [randomUUID(), u.id, family, hash, deviceId, refreshExpires],
  );
  const access = await ctx.tokens.issueAccess({
    sub: u.id,
    role: u.role,
    oid: u.officer_id,
    fam: family,
  });
  return {
    accessToken: access.token,
    accessTokenExpiresAt: access.expiresAt.toISOString(),
    refreshToken: token,
    refreshTokenExpiresAt: refreshExpires.toISOString(),
    user: {
      id: u.id,
      email: u.email,
      displayName: u.display_name,
      role: u.role,
      officerId: u.officer_id,
      isDemo: u.is_demo,
    },
  };
}

export async function login(
  ctx: AppContext,
  input: { email: string; password: string; client: 'web' | 'mobile'; deviceId: string | null },
  requestId: string,
): Promise<SessionTokens> {
  const email = input.email.trim().toLowerCase();
  const { rows } = await ctx.pool.query<UserRow>('SELECT * FROM app_users WHERE email = $1', [
    email,
  ]);
  const user = rows[0];
  if (!user) {
    await verifyPassword(await DUMMY_HASH_PROMISE, input.password); // timing equalisation
    await withTransaction(ctx.pool, (c) =>
      appendAudit(c, {
        actorUserId: null,
        actorRole: null,
        action: 'LOGIN_FAILURE',
        targetType: 'user',
        requestId,
        details: { emailSha256: sha256(email), reason: 'UNKNOWN_ACCOUNT' },
      }),
    );
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  if (user.locked_until && user.locked_until.getTime() > Date.now()) {
    throw new AppError(
      423,
      'ACCOUNT_LOCKED',
      'Account temporarily locked after repeated failures. Try again later.',
    );
  }
  const ok = user.is_active && (await verifyPassword(user.password_hash, input.password));
  if (!ok) {
    await withTransaction(ctx.pool, async (c) => {
      const failures = user.failed_login_count + 1;
      await c.query(
        `UPDATE app_users SET failed_login_count = $2::int,
           locked_until = CASE WHEN $2::int >= $3::int THEN now() + make_interval(mins => $4::int) ELSE locked_until END WHERE id = $1`,
        [user.id, failures, MAX_FAILED_LOGINS, LOCKOUT_MINUTES],
      );
      await appendAudit(c, {
        actorUserId: user.id,
        actorRole: user.role,
        action: 'LOGIN_FAILURE',
        targetType: 'user',
        targetId: user.id,
        requestId,
        details: { reason: user.is_active ? 'BAD_PASSWORD' : 'INACTIVE', failures },
      });
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  if (input.client === 'web' && user.role === 'OFFICER') {
    throw new AppError(403, 'FORBIDDEN', 'Officer accounts use the mobile application.');
  }
  if (input.client === 'mobile' && user.role !== 'OFFICER') {
    throw new AppError(403, 'FORBIDDEN', 'Only officer accounts can sign in on duty devices.');
  }
  return withTransaction(ctx.pool, async (c) => {
    await c.query(
      'UPDATE app_users SET failed_login_count = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
      [user.id],
    );
    const session = await issueSession(ctx, c, user, randomUUID(), input.deviceId);
    await appendAudit(c, {
      actorUserId: user.id,
      actorRole: user.role,
      action: 'LOGIN_SUCCESS',
      targetType: 'user',
      targetId: user.id,
      requestId,
      details: { client: input.client },
    });
    return session;
  });
}

/** Refresh-token rotation with reuse detection. */
export async function refresh(
  ctx: AppContext,
  presented: string,
  requestId: string,
): Promise<SessionTokens> {
  const hash = sha256(presented);
  const result = await withTransaction(ctx.pool, async (c) => {
    const { rows } = await c.query<{
      id: string;
      user_id: string;
      family_id: string;
      device_id: string | null;
      expires_at: Date;
      used_at: Date | null;
      revoked_at: Date | null;
    }>('SELECT * FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE', [hash]);
    const t = rows[0];
    if (!t) return { error: new AppError(401, 'TOKEN_INVALID', 'Refresh token not recognised.') };
    if (t.revoked_at)
      return { error: new AppError(401, 'TOKEN_INVALID', 'Session has been revoked.') };
    if (t.used_at) {
      await c.query(
        "UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'REUSE_DETECTED' WHERE family_id = $1 AND revoked_at IS NULL",
        [t.family_id],
      );
      await appendAudit(c, {
        actorUserId: t.user_id,
        actorRole: null,
        action: 'REFRESH_TOKEN_REUSE_DETECTED',
        targetType: 'session',
        targetId: t.family_id,
        requestId,
      });
      return {
        error: new AppError(
          401,
          'TOKEN_INVALID',
          'Refresh token reuse detected; all sessions in this family were revoked.',
        ),
      };
    }
    if (t.expires_at.getTime() <= Date.now())
      return { error: new AppError(401, 'TOKEN_EXPIRED', 'Refresh token expired.') };
    const u = (await c.query<UserRow>('SELECT * FROM app_users WHERE id = $1', [t.user_id]))
      .rows[0];
    if (!u || !u.is_active)
      return { error: new AppError(401, 'TOKEN_INVALID', 'Account disabled.') };
    await c.query('UPDATE refresh_tokens SET used_at = now() WHERE id = $1', [t.id]);
    return { session: await issueSession(ctx, c, u, t.family_id, t.device_id) };
  });
  if ('error' in result && result.error) throw result.error;
  return (result as { session: SessionTokens }).session;
}

export async function revokeFamily(
  ctx: AppContext,
  family: string,
  userId: string,
  role: string,
  requestId: string,
): Promise<void> {
  await withTransaction(ctx.pool, async (c) => {
    await c.query(
      "UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'LOGOUT' WHERE family_id = $1 AND revoked_at IS NULL",
      [family],
    );
    await appendAudit(c, {
      actorUserId: userId,
      actorRole: role,
      action: 'LOGOUT',
      targetType: 'session',
      targetId: family,
      requestId,
    });
  });
}

export async function familyOfRefreshToken(
  ctx: AppContext,
  presented: string,
): Promise<string | null> {
  const { rows } = await ctx.pool.query<{ family_id: string }>(
    'SELECT family_id FROM refresh_tokens WHERE token_hash = $1',
    [sha256(presented)],
  );
  return rows[0]?.family_id ?? null;
}
