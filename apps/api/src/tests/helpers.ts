import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import type { Express } from 'express';
import { loadEnv } from '../config/env.js';
import { createApp } from '../app.js';
import { createContext } from '../bootstrap.js';
import { migrate } from '../database/migrate.js';
import { DEMO, dropAllPramaanTables, seedDemo } from '../database/seed.js';
import type { AppContext } from '../context.js';
import { SimulatedDevice } from '../tools/sim-device.js';

export const DEMO_PASSWORD = 'Demo-Passw0rd-2026';
export { DEMO };

export function testDbUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    const u = new URL(
      process.env.TEST_DATABASE_ADMIN_URL ??
        'postgres://pramaan:pramaan_dev_only@localhost:5432/postgres',
    );
    u.pathname = `/${process.env.TEST_DATABASE_NAME ?? 'pramaan_test'}`;
    return u.toString();
  }
  return url;
}

export async function setupTestApp(
  overrides: Record<string, string> = {},
): Promise<{ ctx: AppContext; app: Express }> {
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_URL: testDbUrl(),
    JWT_ACCESS_SECRET: 'test-only-jwt-secret-0123456789abcdef0123456789',
    CORS_ORIGINS: 'http://localhost:5173',
    EVIDENCE_STORAGE_DIR: mkdtempSync(join(tmpdir(), 'pramaan-evidence-')),
    RATE_LIMIT_LOGIN_PER_15MIN: '1000',
    RATE_LIMIT_SYNC_PER_MIN: '10000',
    RATE_LIMIT_GENERAL_PER_MIN: '100000',
    MAX_EVIDENCE_BYTES: String(512 * 1024),
    LOG_LEVEL: 'silent',
    ...overrides,
  });
  const ctx = createContext(env);
  await dropAllPramaanTables(ctx.pool);
  await migrate(ctx.pool);
  await seedDemo(ctx.pool, DEMO_PASSWORD);
  return { ctx, app: createApp(ctx) };
}

export async function webLogin(
  app: Express,
  email: string,
): Promise<{ token: string; cookie: string }> {
  const r = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: DEMO_PASSWORD, client: 'web' });
  if (r.status !== 200) throw new Error(`login failed ${r.status} ${JSON.stringify(r.body)}`);
  const cookie = ([] as string[]).concat(r.headers['set-cookie'] ?? [])[0]!.split(';')[0]!;
  return { token: r.body.accessToken as string, cookie };
}

export async function mobileLogin(
  app: Express,
  email: string,
): Promise<{ token: string; refreshToken: string }> {
  const r = await request(app)
    .post('/api/v1/auth/login')
    .send({ email, password: DEMO_PASSWORD, client: 'mobile' });
  if (r.status !== 200) throw new Error(`mobile login failed ${r.status}`);
  return { token: r.body.accessToken as string, refreshToken: r.body.refreshToken as string };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** Registers a simulated device for officer1 and approves it as admin. */
export async function activeDevice(
  app: Express,
  officerToken: string,
  adminToken: string,
  officerId: string = DEMO.officers.o1,
): Promise<SimulatedDevice> {
  const dev = new SimulatedDevice(officerId);
  const reg = await request(app)
    .post('/api/v1/devices/register')
    .set(bearer(officerToken))
    .send(dev.registration());
  if (reg.status !== 201)
    throw new Error(`register failed ${reg.status} ${JSON.stringify(reg.body)}`);
  const ap = await request(app)
    .post(`/api/v1/devices/${dev.deviceId}/approve`)
    .set(bearer(adminToken))
    .send({});
  if (ap.status !== 200) throw new Error(`approve failed ${ap.status}`);
  return dev;
}

/** Point inside DEMO-GNT-PF1. */
export const PF1 = { lat: 16.3004, lon: 80.4505 };
/** Point inside DEMO-GNT-YARD (about 0.5 km from PF1). */
export const YARD = { lat: 16.302, lon: 80.4555 };
