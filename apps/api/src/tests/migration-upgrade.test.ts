import { copyFileSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { findMigrationsDir, migrate } from '../database/migrate.js';
import { appendAudit, verifyFullAuditChain } from '../services/audit.js';
import { hashPassword } from '../security/passwords.js';
import { loadEnv } from '../config/env.js';
import { createContext } from '../bootstrap.js';
import { createApp } from '../app.js';
import { testDbUrl } from './helpers.js';

/**
 * Upgrade path: a database created by PRAMAAN 1.0 (migrations 0001–0005) with existing records is
 * migrated to the current schema. Existing officers, accounts, duty sessions, flags and the audit
 * chain must survive unchanged; legacy ranks are mapped; legacy accounts keep working.
 */
const DB = 'pramaan_upgrade_test';
let admin: pg.Client;
let pool: pg.Pool;
let url: string;

beforeAll(async () => {
  const u = new URL(testDbUrl());
  u.pathname = '/postgres';
  admin = new pg.Client({ connectionString: u.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${DB}`);
  u.pathname = `/${DB}`;
  url = u.toString();
  pool = new pg.Pool({ connectionString: url, max: 3 });
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  await admin.end();
});

describe('upgrade from the PRAMAAN 1.0 schema', () => {
  it('keeps existing records intact and maps legacy ranks', async () => {
    const legacyDir = mkdtempSync(join(tmpdir(), 'pramaan-legacy-migrations-'));
    for (const f of readdirSync(findMigrationsDir()).filter((x) => /^000[1-5]_/.test(x)))
      copyFileSync(join(findMigrationsDir(), f), join(legacyDir, f));
    const first = await migrate(pool, legacyDir);
    expect(first.applied.length).toBe(5);

    const hash = await hashPassword('Legacy-Passw0rd-2026');
    await pool.query(`INSERT INTO officers (id, employee_ref, display_name, rank, station) VALUES
      ('20000000-0000-4000-8000-0000000000a1', 'LEG-PC-1', 'Legacy Constable', 'CONSTABLE', 'Legacy station'),
      ('20000000-0000-4000-8000-0000000000a2', 'LEG-HC-2', 'Legacy Head Constable', 'HEAD_CONSTABLE', 'Legacy station'),
      ('20000000-0000-4000-8000-0000000000a3', 'LEG-IN-3', 'Legacy Inspector', 'INSPECTOR', 'Legacy station')`);
    await pool.query(
      `INSERT INTO app_users (id, email, display_name, role, password_hash, officer_id) VALUES
        ('10000000-0000-4000-8000-0000000000a1', 'legacy.officer@pramaan.demo', 'Legacy Constable', 'OFFICER', $1, '20000000-0000-4000-8000-0000000000a1'),
        ('10000000-0000-4000-8000-0000000000a9', 'legacy.admin@pramaan.demo', 'Legacy Admin', 'ADMIN', $1, NULL)`,
      [hash],
    );
    await pool.query(`INSERT INTO duty_sessions (id, officer_id, planned_start, planned_end, authorized_by)
      VALUES ('30000000-0000-4000-8000-0000000000a1', '20000000-0000-4000-8000-0000000000a1', now() - interval '1 hour', now() + interval '4 hours', '10000000-0000-4000-8000-0000000000a9')`);
    await pool.query(`INSERT INTO review_flags (id, flag_type, severity, title, description, officer_id, dedupe_key)
      VALUES ('40000000-0000-4000-8000-0000000000a1', 'CHECKIN_MISSED', 'LOW', 'Legacy flag', 'kept', '20000000-0000-4000-8000-0000000000a1', 'legacy-1')`);
    const c = await pool.connect();
    await c.query('BEGIN');
    await appendAudit(c, { actorUserId: null, actorRole: 'SYSTEM', action: 'LEGACY_EVENT', targetType: 'database' });
    await c.query('COMMIT');
    c.release();

    const second = await migrate(pool);
    expect(second.applied).toEqual(['0006_rbac_personnel.sql', '0007_duty_operations.sql']);
    expect((await migrate(pool)).applied).toEqual([]); // repeatable: nothing left to apply

    const ranks = await pool.query('SELECT employee_ref, rank, personnel_category FROM officers ORDER BY employee_ref');
    expect(ranks.rows).toEqual([
      { employee_ref: 'LEG-HC-2', rank: 'HC', personnel_category: 'POLICE' },
      { employee_ref: 'LEG-IN-3', rank: 'CI', personnel_category: 'POLICE' },
      { employee_ref: 'LEG-PC-1', rank: 'PC', personnel_category: 'POLICE' },
    ]);
    expect((await pool.query('SELECT count(*)::int n FROM duty_sessions')).rows[0].n).toBe(1);
    expect((await pool.query("SELECT title FROM review_flags WHERE id = '40000000-0000-4000-8000-0000000000a1'")).rows[0].title).toBe('Legacy flag');
    const audit = await verifyFullAuditChain(pool);
    expect(audit.ok).toBe(true);
    expect(audit.checked).toBe(1);

    // Legacy accounts still authenticate with their original roles and permissions.
    const env = loadEnv({
      NODE_ENV: 'test',
      DATABASE_URL: url,
      JWT_ACCESS_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789',
      LOG_LEVEL: 'silent',
      EVIDENCE_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'pramaan-up-')),
    });
    const ctx = createContext(env);
    const app = createApp(ctx);
    const off = await request(app).post('/api/v1/auth/login').send({ email: 'legacy.officer@pramaan.demo', password: 'Legacy-Passw0rd-2026', client: 'mobile' });
    expect(off.status).toBe(200);
    const duties = await request(app).get('/api/v1/duties').set('Authorization', `Bearer ${off.body.accessToken}`);
    expect(duties.body.items.map((d: { id: string }) => d.id)).toEqual(['30000000-0000-4000-8000-0000000000a1']);
    const adm = await request(app).post('/api/v1/auth/login').send({ email: 'legacy.admin@pramaan.demo', password: 'Legacy-Passw0rd-2026' });
    expect(adm.status).toBe(200);
    expect(adm.body.user.permissions).toContain('users.manage');
    await ctx.pool.end();
  });
});
