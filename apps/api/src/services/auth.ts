import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { AppError } from '../middleware/errors.js';
import { DUMMY_HASH_PROMISE, hashPassword, passwordPolicyIssues, verifyPassword } from '../security/passwords.js';
import type { AuthUser } from '../middleware/auth.js';
import { newRefreshToken, sha256, type Role } from '../security/tokens.js';
import { appendAudit } from './audit.js';

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;

export interface SessionTokens {
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  user: SessionUser;
}

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  role: Role;
  roleLabel: string;
  officerId: string | null;
  isDemo: boolean;
  permissions: string[];
  scopeLevel: string;
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
  officer_active: boolean | null;
  role_label: string;
  scope_level: string;
  permissions: string[];
}

const USER_SQL = `SELECT u.*, o.is_active AS officer_active, r.label AS role_label, r.scope_level,
    COALESCE((SELECT array_agg(rp.permission_code ORDER BY rp.permission_code) FROM role_permissions rp WHERE rp.role_code = u.role), '{}') AS permissions
  FROM app_users u JOIN roles r ON r.code = u.role LEFT JOIN officers o ON o.id = u.officer_id`;

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
      roleLabel: u.role_label,
      officerId: u.officer_id,
      isDemo: u.is_demo,
      permissions: u.permissions,
      scopeLevel: u.scope_level,
    },
  };
}

export async function login(
  ctx: AppContext,
  input: { email: string; password: string; client: 'web' | 'mobile'; deviceId: string | null },
  requestId: string,
): Promise<SessionTokens> {
  const email = input.email.trim().toLowerCase();
  const { rows } = await ctx.pool.query<UserRow>(`${USER_SQL} WHERE u.email = $1`, [email]);
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
  const demoBlocked = user.is_demo && !ctx.env.demoLoginAllowed;
  const accountUsable = user.is_active && user.officer_active !== false && !demoBlocked;
  const ok = accountUsable && (await verifyPassword(user.password_hash, input.password));
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
        details: {
          reason: demoBlocked
            ? 'DEMO_LOGIN_DISABLED'
            : !user.is_active || user.officer_active === false
              ? 'INACTIVE'
              : 'BAD_PASSWORD',
          failures,
        },
      });
    });
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  if (input.client === 'web' && !user.permissions.includes('web.login')) {
    throw new AppError(403, 'FORBIDDEN', 'This account uses the mobile application only.');
  }
  if (input.client === 'mobile' && !user.permissions.includes('mobile.login')) {
    throw new AppError(403, 'FORBIDDEN', 'This account cannot sign in on duty devices.');
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
    const u = (await c.query<UserRow>(`${USER_SQL} WHERE u.id = $1`, [t.user_id])).rows[0];
    if (!u || !u.is_active || u.officer_active === false || (u.is_demo && !ctx.env.demoLoginAllowed))
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

/** Self-service password change; other sessions are revoked, the current one is kept. */
export async function changeOwnPassword(
  ctx: AppContext,
  u: AuthUser,
  current: string,
  next: string,
  requestId: string,
): Promise<void> {
  const row = (await ctx.pool.query<{ password_hash: string }>('SELECT password_hash FROM app_users WHERE id = $1', [u.id])).rows[0];
  if (!row || !(await verifyPassword(row.password_hash, current)))
    throw new AppError(400, 'VALIDATION_FAILED', 'Current password is incorrect.');
  const issues = passwordPolicyIssues(next);
  if (issues.length) throw new AppError(400, 'VALIDATION_FAILED', `New password needs ${issues.join(', ')}.`);
  const hash = await hashPassword(next);
  await withTransaction(ctx.pool, async (c) => {
    await c.query('UPDATE app_users SET password_hash = $2 WHERE id = $1', [u.id, hash]);
    await c.query(
      "UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'PASSWORD_CHANGED' WHERE user_id = $1 AND family_id <> $2 AND revoked_at IS NULL",
      [u.id, u.family],
    );
    await appendAudit(c, {
      actorUserId: u.id,
      actorRole: u.role,
      action: 'PASSWORD_CHANGED',
      targetType: 'user',
      targetId: u.id,
      requestId,
    });
  });
}
