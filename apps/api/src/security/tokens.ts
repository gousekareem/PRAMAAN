import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify, errors } from 'jose';
import type { Env } from '../config/env.js';
import { AppError } from '../middleware/errors.js';

export type Role = 'ADMIN' | 'SUPERVISOR' | 'REVIEWER' | 'OFFICER';
export const ROLES: readonly Role[] = ['ADMIN', 'SUPERVISOR', 'REVIEWER', 'OFFICER'];

export interface AccessClaims {
  sub: string;
  role: Role;
  oid: string | null;
  fam: string;
}

export class TokenService {
  private readonly key: Uint8Array;
  constructor(private readonly env: Env) {
    this.key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
  }

  async issueAccess(c: AccessClaims): Promise<{ token: string; expiresAt: Date }> {
    const expiresAt = new Date(Date.now() + this.env.ACCESS_TOKEN_TTL_SECONDS * 1000);
    const token = await new SignJWT({ role: c.role, oid: c.oid, fam: c.fam })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(c.sub)
      .setIssuer(this.env.JWT_ISSUER)
      .setAudience('pramaan')
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .setJti(randomBytes(12).toString('hex'))
      .sign(this.key);
    return { token, expiresAt };
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: this.env.JWT_ISSUER,
        audience: 'pramaan',
        algorithms: ['HS256'],
      });
      const role = payload.role as Role;
      if (!payload.sub || !ROLES.includes(role) || typeof payload.fam !== 'string')
        throw new AppError(401, 'TOKEN_INVALID', 'Invalid access token.');
      return {
        sub: payload.sub,
        role,
        oid: (payload.oid as string | null) ?? null,
        fam: payload.fam,
      };
    } catch (e) {
      if (e instanceof AppError) throw e;
      if (e instanceof errors.JWTExpired)
        throw new AppError(401, 'TOKEN_EXPIRED', 'Access token expired.');
      throw new AppError(401, 'TOKEN_INVALID', 'Invalid access token.');
    }
  }
}

export function newRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: sha256(token) };
}

export function sha256(v: string | Buffer): string {
  return createHash('sha256').update(v).digest('hex');
}
