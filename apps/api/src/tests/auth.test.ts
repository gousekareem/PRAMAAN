import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { SignJWT } from 'jose';
import { bearer, DEMO, DEMO_PASSWORD, mobileLogin, setupTestApp, webLogin } from './helpers.js';
import type { AppContext } from '../context.js';
import type { Express } from 'express';

let ctx: AppContext;
let app: Express;
beforeAll(async () => ({ ctx, app } = await setupTestApp()));
afterAll(async () => ctx.pool.end());

describe('health', () => {
  it('GET /health is a liveness probe', async () => {
    const r = await request(app).get('/health');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('ok');
    expect(r.headers['x-request-id']).toBeTruthy();
  });
  it('GET /ready checks database, PostGIS, migrations and storage', async () => {
    const r = await request(app).get('/ready');
    expect(r.status).toBe(200);
    expect(r.body.checks.postgis).toMatch(/^3\./);
    expect(Number(r.body.checks.migrations)).toBe(5);
  });
});

describe('authentication', () => {
  it('web login sets an httpOnly refresh cookie and never returns the refresh token in the body', async () => {
    const r = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: DEMO.emails.supervisor, password: DEMO_PASSWORD });
    expect(r.status).toBe(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.refreshToken).toBeUndefined();
    expect(JSON.stringify(r.body)).not.toContain('password');
    const cookie = String(r.headers['set-cookie']);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/api/v1/auth');
  });
  it('rejects bad credentials with a generic message and request id', async () => {
    const r = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: DEMO.emails.supervisor, password: 'wrong-password' });
    expect(r.status).toBe(401);
    expect(r.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(r.body.error.requestId).toBeTruthy();
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@pramaan.demo', password: 'x' });
    expect(unknown.body.error.message).toBe(r.body.error.message);
  });
  it('separates officer (mobile) and dashboard (web) clients', async () => {
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: DEMO.emails.officer1, password: DEMO_PASSWORD, client: 'web' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post('/api/v1/auth/login')
          .send({ email: DEMO.emails.admin, password: DEMO_PASSWORD, client: 'mobile' })
      ).status,
    ).toBe(403);
  });
  it('rotates refresh tokens (cookie needs the anti-CSRF header) and detects reuse', async () => {
    const { cookie } = await webLogin(app, DEMO.emails.reviewer);
    expect((await request(app).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(
      403,
    );
    const r1 = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('X-PRAMAAN-CSRF', '1');
    expect(r1.status).toBe(200);
    const rotated = String(r1.headers['set-cookie']).split(';')[0]!;
    expect(rotated).not.toBe(cookie);
    // Reusing the old token revokes the whole family.
    const reuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('X-PRAMAAN-CSRF', '1');
    expect(reuse.status).toBe(401);
    const afterReuse = await request(app)
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotated)
      .set('X-PRAMAAN-CSRF', '1');
    expect(afterReuse.status).toBe(401);
    // Access token of the revoked family is rejected immediately.
    expect(
      (await request(app).get('/api/v1/auth/me').set(bearer(r1.body.accessToken))).status,
    ).toBe(401);
  });
  it('mobile refresh uses the body token', async () => {
    const s = await mobileLogin(app, DEMO.emails.officer2);
    const r = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: s.refreshToken });
    expect(r.status).toBe(200);
    expect(r.body.refreshToken).not.toBe(s.refreshToken);
  });
  it('logout revokes the session (access token no longer accepted)', async () => {
    const { token } = await webLogin(app, DEMO.emails.reviewer);
    expect((await request(app).post('/api/v1/auth/logout').set(bearer(token))).status).toBe(204);
    expect((await request(app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
  });
  it('rejects expired and forged access tokens', async () => {
    const key = new TextEncoder().encode(ctx.env.JWT_ACCESS_SECRET);
    const expired = await new SignJWT({ role: 'ADMIN', oid: null, fam: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(DEMO.users.admin)
      .setIssuer(ctx.env.JWT_ISSUER)
      .setAudience('pramaan')
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(key);
    const r = await request(app).get('/api/v1/officers').set(bearer(expired));
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('TOKEN_EXPIRED');
    const forged = await new SignJWT({ role: 'ADMIN', oid: null, fam: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(DEMO.users.admin)
      .setIssuer(ctx.env.JWT_ISSUER)
      .setAudience('pramaan')
      .setExpirationTime('10m')
      .sign(new TextEncoder().encode('attacker-secret-attacker-secret-attacker'));
    expect((await request(app).get('/api/v1/officers').set(bearer(forged))).body.error.code).toBe(
      'TOKEN_INVALID',
    );
  });
  it('locks the account after repeated failures', async () => {
    for (let i = 0; i < 5; i++)
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: DEMO.emails.officer2, password: 'bad', client: 'mobile' });
    const r = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: DEMO.emails.officer2, password: DEMO_PASSWORD, client: 'mobile' });
    expect(r.status).toBe(423);
    expect(r.body.error.code).toBe('ACCOUNT_LOCKED');
  });
});

describe('authorization and validation', () => {
  it('requires authentication on protected endpoints', async () => {
    for (const p of [
      '/api/v1/officers',
      '/api/v1/duties',
      '/api/v1/patrol-logs',
      '/api/v1/dashboard/summary',
      '/api/v1/audit-events',
      '/api/v1/evidence',
    ]) {
      expect((await request(app).get(p)).status).toBe(401);
    }
  });
  it('enforces roles', async () => {
    const reviewer = (await webLogin(app, DEMO.emails.reviewer)).token;
    const officer = (await mobileLogin(app, DEMO.emails.officer1)).token;
    expect((await request(app).post('/api/v1/duties').set(bearer(reviewer)).send({})).status).toBe(
      403,
    );
    expect((await request(app).get('/api/v1/audit-events').set(bearer(reviewer))).status).toBe(403);
    expect((await request(app).get('/api/v1/officers').set(bearer(officer))).status).toBe(403);
    expect((await request(app).get('/api/v1/dashboard/summary').set(bearer(reviewer))).status).toBe(
      200,
    );
  });
  it('prevents broken object-level authorization (officer cannot read another officer)', async () => {
    const officer = (await mobileLogin(app, DEMO.emails.officer1)).token;
    expect(
      (await request(app).get(`/api/v1/officers/${DEMO.officers.o1}`).set(bearer(officer))).status,
    ).toBe(200);
    expect(
      (await request(app).get(`/api/v1/officers/${DEMO.officers.o2}`).set(bearer(officer))).status,
    ).toBe(404);
    const duties = await request(app).get('/api/v1/duties').set(bearer(officer));
    expect(
      duties.body.items.every((d: { officerId: string }) => d.officerId === DEMO.officers.o1),
    ).toBe(true);
  });
  it('validates path, query and body input', async () => {
    const sup = (await webLogin(app, DEMO.emails.supervisor)).token;
    expect(
      (await request(app).get('/api/v1/officers/not-a-uuid').set(bearer(sup))).body.error.code,
    ).toBe('VALIDATION_FAILED');
    expect((await request(app).get('/api/v1/officers?pageSize=5000').set(bearer(sup))).status).toBe(
      400,
    );
    const bad = await request(app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email":');
    expect(bad.status).toBe(400);
    const r = await request(app)
      .post('/api/v1/duties')
      .set(bearer(sup))
      .send({ officerId: DEMO.officers.o1, plannedStart: 'x', plannedEnd: 'y', zoneIds: [] });
    expect(r.status).toBe(400);
    expect(r.body.error.details.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.body)).not.toMatch(/at .*\.ts/); // no stack traces
  });
  it('rejects oversized JSON bodies', async () => {
    const sup = (await webLogin(app, DEMO.emails.supervisor)).token;
    const huge = { notes: 'x'.repeat(3 * 1024 * 1024) };
    const r = await request(app).post('/api/v1/duties').set(bearer(sup)).send(huge);
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('PAYLOAD_TOO_LARGE');
  });
  it('rejects CORS requests from non-allowlisted origins', async () => {
    const ok = await request(app).get('/health').set('Origin', 'http://localhost:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const evil = await request(app).get('/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });
  it('sets secure headers', async () => {
    const r = await request(app).get('/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.headers['x-powered-by']).toBeUndefined();
  });
});

describe('rate limiting', () => {
  it('limits login attempts', async () => {
    const { ctx: c2, app: a2 } = await setupTestApp({ RATE_LIMIT_LOGIN_PER_15MIN: '3' });
    const codes: number[] = [];
    for (let i = 0; i < 5; i++)
      codes.push(
        (
          await request(a2)
            .post('/api/v1/auth/login')
            .send({ email: DEMO.emails.reviewer, password: 'nope' })
        ).status,
      );
    expect(codes.slice(0, 3)).toEqual([401, 401, 401]);
    expect(codes[4]).toBe(429);
    await c2.pool.end();
    // restore the shared database for subsequent files
    await setupTestApp().then((x) => x.ctx.pool.end());
  });
});
