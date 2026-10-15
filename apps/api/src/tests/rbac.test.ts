import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AppContext } from '../context.js';
import {
  bearer,
  DEMO_ACCOUNTS,
  DEMO_ASSIGNMENTS,
  DEMO_PERSON,
  DEMO_UNITS,
  rankLogin,
  setupTestApp,
} from './helpers.js';
import { loadEnv } from '../config/env.js';

let ctx: AppContext;
let app: Express;
beforeAll(async () => ({ ctx, app } = await setupTestApp()));
afterAll(async () => ctx.pool.end());

describe('rank demonstration accounts', () => {
  it('every requested demo account can sign in to the dashboard with its documented password', async () => {
    for (const a of DEMO_ACCOUNTS) {
      const r = await request(app).post('/api/v1/auth/login').send({ email: a.email, password: a.password, client: 'web' });
      expect(r.status, a.email).toBe(200);
      expect(r.body.user.role).toBe(a.role);
      expect(r.body.user.isDemo).toBe(true);
      expect(Array.isArray(r.body.user.permissions)).toBe(true);
    }
  });

  it('uses exactly the requested login convention', () => {
    const expected = ['hg', 'pc', 'pc.ar', 'hc', 'asi', 'si', 'ci', 'dsp'];
    for (const k of expected) {
      const a = DEMO_ACCOUNTS.find((x) => x.key === k)!;
      expect(a.email).toBe(`${k}@parmaan.demo`);
      expect(a.password).toBe(`${k}-parmaan.demo`);
    }
  });

  it('stores passwords only as Argon2id hashes', async () => {
    const { rows } = await ctx.pool.query<{ email: string; password_hash: string }>(
      "SELECT email, password_hash FROM app_users WHERE email LIKE '%@parmaan.demo'",
    );
    expect(rows.length).toBe(DEMO_ACCOUNTS.length);
    for (const r of rows) {
      expect(r.password_hash.startsWith('$argon2id$')).toBe(true);
      const plain = DEMO_ACCOUNTS.find((a) => a.email === r.email)!.password;
      expect(r.password_hash).not.toContain(plain);
    }
  });

  it('rejects invalid credentials', async () => {
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'hg@parmaan.demo', password: 'wrong-password', client: 'web' });
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('represents PC — AR as a personnel attribute, not an extra rank or permission', async () => {
    const pc = await rankLogin(app, 'pc');
    const ar = await rankLogin(app, 'pc.ar');
    expect(ar.user.permissions).toEqual(pc.user.permissions);
    const me = await request(app).get('/api/v1/auth/me').set(bearer(ar.token));
    expect(me.body.user.role).toBe('PC');
    expect(me.body.user.personnel).toMatchObject({ rank: 'PC', constableCategory: 'AR', personnelCategory: 'POLICE' });
    const hg = await request(app).get('/api/v1/auth/me').set(bearer((await rankLogin(app, 'hg')).token));
    expect(hg.body.user.personnel).toMatchObject({ personnelCategory: 'HOME_GUARD', rank: null });
  });

  it('allows field accounts on the duty device and refuses DSP / administrator there', async () => {
    for (const k of ['hg', 'pc', 'pc.ar', 'hc', 'asi', 'si', 'ci'] as const) await rankLogin(app, k, 'mobile');
    for (const k of ['dsp', 'admin']) {
      const a = DEMO_ACCOUNTS.find((x) => x.key === k)!;
      const r = await request(app).post('/api/v1/auth/login').send({ email: a.email, password: a.password, client: 'mobile' });
      expect(r.status).toBe(403);
    }
  });

  it('logout revokes the session token', async () => {
    const { token } = await rankLogin(app, 'asi');
    expect((await request(app).post('/api/v1/auth/logout').set(bearer(token))).status).toBe(204);
    expect((await request(app).get('/api/v1/auth/me').set(bearer(token))).status).toBe(401);
  });

  it('lists and revokes own sessions only', async () => {
    const a = await rankLogin(app, 'hc');
    const b = await rankLogin(app, 'hc');
    const list = await request(app).get('/api/v1/auth/sessions').set(bearer(a.token));
    expect(list.body.items.length).toBeGreaterThanOrEqual(2);
    const other = list.body.items.find((s: { current: boolean }) => !s.current);
    expect((await request(app).post(`/api/v1/auth/sessions/${other.familyId}/revoke`).set(bearer(a.token))).status).toBe(204);
    expect((await request(app).get('/api/v1/auth/me').set(bearer(b.token))).status).toBe(401);
    const si = await rankLogin(app, 'si');
    expect((await request(app).post(`/api/v1/auth/sessions/${list.body.items[0].familyId}/revoke`).set(bearer(si.token))).status).toBe(404);
  });

  it('refuses demo logins in production unless explicitly enabled', async () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgres://x@y/z',
      JWT_ACCESS_SECRET: 'a-long-random-value-0123456789abcdefghij-XYZ',
      CORS_ORIGINS: 'https://dashboard.example.org',
    };
    expect(loadEnv(base).demoLoginAllowed).toBe(false);
    expect(loadEnv({ ...base, ALLOW_DEMO_LOGIN: 'true' }).demoLoginAllowed).toBe(true);
    expect(loadEnv({ NODE_ENV: 'development', DATABASE_URL: 'x', JWT_ACCESS_SECRET: 'dev-only-secret-0123456789abcdef0123' }).demoLoginAllowed).toBe(true);
    const { ctx: c2, app: a2 } = await setupTestApp({ ALLOW_DEMO_LOGIN: 'false' });
    const r = await request(a2).post('/api/v1/auth/login').send({ email: 'si@parmaan.demo', password: 'si-parmaan.demo' });
    expect(r.status).toBe(401);
    await c2.pool.end();
    await setupTestApp().then((x) => x.ctx.pool.end());
  });
});

describe('server-side authorisation', () => {
  it('HG cannot reach administrative or supervisory endpoints', async () => {
    const { token } = await rankLogin(app, 'hg');
    for (const [m, p] of [
      ['get', '/api/v1/accounts'],
      ['get', '/api/v1/audit-events'],
      ['get', '/api/v1/system/status'],
      ['get', '/api/v1/personnel'],
      ['get', '/api/v1/dashboard/alerts'],
      ['get', '/api/v1/reports/summary'],
      ['get', '/api/v1/policy/roles'],
      ['post', '/api/v1/duty-assignments'],
    ] as const) {
      const r = await request(app)[m](p).set(bearer(token)).send({});
      expect(r.status, `${m} ${p}`).toBe(403);
    }
  });

  it('permissions come from the database, not from the token claim', async () => {
    const { token } = await rankLogin(app, 'hg');
    expect((await request(app).get('/api/v1/accounts').set(bearer(token))).status).toBe(403);
    // A forged role claim signed with the real key still grants nothing: the role is re-read.
    const { SignJWT } = await import('jose');
    const [, payload] = token.split('.');
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString()) as Record<string, unknown>;
    const forged = await new SignJWT({ ...claims, role: 'ADMIN' })
      .setProtectedHeader({ alg: 'HS256' })
      .sign(new TextEncoder().encode('test-only-jwt-secret-0123456789abcdef0123456789'));
    expect((await request(app).get('/api/v1/accounts').set(bearer(forged))).status).toBe(403);
  });

  it('users cannot change their own role, status or personnel record', async () => {
    const admin = await rankLogin(app, 'admin');
    const r = await request(app)
      .patch(`/api/v1/accounts/${admin.user.id}`)
      .set(bearer(admin.token))
      .send({ role: 'SI', reason: 'attempted self change' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('SELF_MODIFICATION_FORBIDDEN');
    const si = await rankLogin(app, 'si');
    const own = await request(app).patch(`/api/v1/personnel/${DEMO_PERSON.si1}`).set(bearer(si.token)).send({ rank: 'DSP', reason: 'promote myself' });
    expect(own.status).toBe(403);
  });

  it('an administrator role change takes effect immediately and ends the old sessions', async () => {
    const admin = await rankLogin(app, 'admin');
    const hc = await rankLogin(app, 'hc');
    expect((await request(app).get('/api/v1/personnel').set(bearer(hc.token))).status).toBe(200);
    const acc = DEMO_ACCOUNTS.find((a) => a.key === 'hc')!;
    expect(
      (await request(app).patch(`/api/v1/accounts/${acc.id}`).set(bearer(admin.token)).send({ role: 'PC', reason: 'demo downgrade test' })).status,
    ).toBe(200);
    expect((await request(app).get('/api/v1/personnel').set(bearer(hc.token))).status).toBe(401);
    const again = await rankLogin(app, 'hc');
    expect((await request(app).get('/api/v1/personnel').set(bearer(again.token))).status).toBe(403);
    await request(app).patch(`/api/v1/accounts/${acc.id}`).set(bearer(admin.token)).send({ role: 'HC', reason: 'restore demo role' }).expect(200);
    const audit = await ctx.pool.query("SELECT count(*)::int n FROM audit_events WHERE action = 'ACCOUNT_UPDATED' AND target_id = $1", [acc.id]);
    expect(audit.rows[0].n).toBe(2);
  });

  it('inactive personnel cannot authenticate and existing sessions stop working', async () => {
    const admin = await rankLogin(app, 'admin');
    const asi = await rankLogin(app, 'asi');
    await request(app).post(`/api/v1/personnel/${DEMO_PERSON.asi1}/status`).set(bearer(admin.token)).send({ isActive: false, reason: 'demo deactivation' }).expect(200);
    expect((await request(app).get('/api/v1/auth/me').set(bearer(asi.token))).status).toBe(401);
    const r = await request(app).post('/api/v1/auth/login').send({ email: 'asi@parmaan.demo', password: 'asi-parmaan.demo' });
    expect(r.status).toBe(401);
    // Deactivating flags the person's open assignments for review; history is preserved.
    const flags = await ctx.pool.query("SELECT count(*)::int n FROM review_flags WHERE flag_type = 'INACTIVE_PERSONNEL_ASSIGNED' AND officer_id = $1", [DEMO_PERSON.asi1]);
    expect(flags.rows[0].n).toBeGreaterThan(0);
    await request(app).post(`/api/v1/personnel/${DEMO_PERSON.asi1}/status`).set(bearer(admin.token)).send({ isActive: true, reason: 'demo reactivation' }).expect(200);
    await rankLogin(app, 'asi');
  });

  it('personnel records cannot be deleted', async () => {
    await expect(ctx.pool.query('DELETE FROM officers WHERE id = $1', [DEMO_PERSON.pcx])).rejects.toThrow(/cannot be deleted/);
  });
});

describe('scope boundaries', () => {
  const names = async (token: string) =>
    (await request(app).get('/api/v1/personnel?pageSize=100').set(bearer(token))).body.items.map((p: { unitId: string }) => p.unitId);

  it('HC and SI see only their station; CI sees the circle; DSP sees the sub-division', async () => {
    const hc = new Set(await names((await rankLogin(app, 'hc')).token));
    expect([...hc]).toEqual([DEMO_UNITS.stationGuntur]);
    const si = new Set(await names((await rankLogin(app, 'si')).token));
    expect([...si]).toEqual([DEMO_UNITS.stationGuntur]);
    const ci = new Set(await names((await rankLogin(app, 'ci')).token));
    expect(ci.has(DEMO_UNITS.stationTenali)).toBe(true);
    expect(ci.has(DEMO_UNITS.stationNarasaraopet)).toBe(false);
    const dsp = new Set(await names((await rankLogin(app, 'dsp')).token));
    expect(dsp.has(DEMO_UNITS.stationNarasaraopet)).toBe(true);
  });

  it('out-of-scope records are reported as not found', async () => {
    const si = await rankLogin(app, 'si');
    expect((await request(app).get(`/api/v1/personnel/${DEMO_PERSON.pcg4}`).set(bearer(si.token))).status).toBe(404);
    expect((await request(app).get(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.tiNarasaraopetDraft}`).set(bearer(si.token))).status).toBe(404);
    const ci = await rankLogin(app, 'ci');
    expect((await request(app).get(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.swNarasaraopetTomorrow}`).set(bearer(ci.token))).status).toBe(404);
  });

  it('field accounts see only their own duties and own record', async () => {
    const hg = await rankLogin(app, 'hg');
    const list = await request(app).get('/api/v1/duty-assignments?pageSize=100').set(bearer(hg.token));
    expect(list.status).toBe(200);
    const ids = list.body.items.map((a: { id: string }) => a.id);
    expect(ids).toEqual([DEMO_ASSIGNMENTS.swTodayMorning]);
    for (const a of list.body.items)
      expect(a.personnel.some((p: { officerId: string }) => p.officerId === DEMO_PERSON.hg1)).toBe(true);
    expect((await request(app).get(`/api/v1/personnel/${DEMO_PERSON.hg1}`).set(bearer(hg.token))).status).toBe(200);
    expect((await request(app).get(`/api/v1/personnel/${DEMO_PERSON.hg2}`).set(bearer(hg.token))).status).toBe(404);
  });

  it('restricted VIP / incident details are hidden from users without duty.view_restricted', async () => {
    const dsp = await rankLogin(app, 'dsp');
    const d = await request(app).get(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.vipTomorrow}`).set(bearer(dsp.token));
    expect(d.status).toBe(200);
    expect(d.body.detailsVisible).toBe(false);
    expect(d.body.escortLabel).toBeNull();
    expect(d.body.reportingLocation).toBeNull();
    expect(d.body.title).toContain('restricted');
    expect(d.body.instructions.every((i: { body: string | null }) => i.body === null)).toBe(true);
    const si = await rankLogin(app, 'si');
    const s = await request(app).get(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.vipTomorrow}`).set(bearer(si.token));
    expect(s.body.escortLabel).toContain('DEMO-VIP-A');
    // An assigned PC (no duty.view_restricted) sees the details of a duty they are on.
    const ar = await rankLogin(app, 'pc.ar');
    const a = await request(app).get(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.vipTomorrow}`).set(bearer(ar.token));
    expect(a.body.detailsVisible).toBe(true);
  });

  it('reports are scoped to the caller', async () => {
    const si = await rankLogin(app, 'si');
    const csv = await request(app).get('/api/v1/reports/assignments.csv').set(bearer(si.token));
    expect(csv.status).toBe(200);
    expect(csv.text).not.toContain('Narasaraopet');
    const dsp = await rankLogin(app, 'dsp');
    const all = await request(app).get('/api/v1/reports/assignments.csv').set(bearer(dsp.token));
    expect(all.text).toContain('Narasaraopet');
    expect(all.text).toContain('restricted details');
  });
});
