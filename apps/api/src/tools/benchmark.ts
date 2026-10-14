/**
 * Repeatable micro-benchmarks. Results depend entirely on the machine; they are measurements of
 * THIS run, not performance guarantees.
 *
 * Usage (API running with demo data): pnpm bench -- --api http://localhost:4000 --password <pw> [--out ./out/bench.json]
 */
import { createHash, randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { computeEventHash } from '@pramaan/event-contracts';
import { verifyPackageZip } from '@pramaan/verifier';
import { loadDatabaseEnv } from '../config/env.js';
import { createPool } from '../database/pool.js';
import { evaluateLocation } from '../spatial/zones.js';
import { SimulatedDevice } from './sim-device.js';

const arg = (n: string, d?: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const API = arg('api', 'http://localhost:4000')!;
const PASSWORD = arg('password', process.env.SEED_DEMO_PASSWORD);
const OUT = arg('out', './out/bench.json')!;

function stats(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return {
    n: s.length,
    meanMs: +(s.reduce((a, b) => a + b, 0) / s.length).toFixed(3),
    p50Ms: +q(0.5).toFixed(3),
    p95Ms: +q(0.95).toFixed(3),
    maxMs: +s[s.length - 1]!.toFixed(3),
  };
}

async function post(path: string, token: string | null, json: unknown) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(json),
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dev tool reading loosely-typed JSON
  return { status: r.status, body: (await r.json().catch(() => null)) as any };
}

async function main() {
  const results: Record<string, unknown> = {
    measuredAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform} ${process.arch}`,
    note: 'Single-machine measurement; API, PostgreSQL and the client ran on the same host.',
  };

  // 1. Event hashing throughput (canonical JSON + SHA-256)
  const dev = new SimulatedDevice('20000000-0000-4000-8000-000000000001');
  const sample = dev.location(16.3004, 80.4505, 6);
  const N = 20_000;
  let t = performance.now();
  for (let i = 0; i < N; i++) computeEventHash({ ...sample, deviceSequenceNumber: i + 1 });
  const hashMs = performance.now() - t;
  results.eventHashing = {
    events: N,
    totalMs: +hashMs.toFixed(1),
    eventsPerSecond: Math.round(N / (hashMs / 1000)),
  };

  // 2. SHA-256 of an 8 MiB evidence buffer (bounded upload limit)
  const big = randomBytes(8 * 1024 * 1024);
  const shaTimes: number[] = [];
  for (let i = 0; i < 10; i++) {
    t = performance.now();
    createHash('sha256').update(big).digest('hex');
    shaTimes.push(performance.now() - t);
  }
  results.evidenceSha256_8MiB = stats(shaTimes);

  // 3. Spatial classification latency (PostGIS)
  const env = loadDatabaseEnv();
  const pool = createPool(env);
  const sp: number[] = [];
  for (let i = 0; i < 500; i++) {
    t = performance.now();
    await evaluateLocation(
      pool,
      80.449 + Math.random() * 0.01,
      16.2995 + Math.random() * 0.004,
      10,
      '30000000-0000-4000-8000-000000000001',
    );
    sp.push(performance.now() - t);
  }
  results.spatialQuery = stats(sp);

  // 4. Batch ingestion latency over HTTP (50 signed events per batch)
  if (PASSWORD) {
    const off = await post('/api/v1/auth/login', null, {
      email: 'officer2@pramaan.demo',
      password: PASSWORD,
      client: 'mobile',
    });
    const adm = await post('/api/v1/auth/login', null, {
      email: 'admin@pramaan.demo',
      password: PASSWORD,
      client: 'web',
    });
    const d2 = new SimulatedDevice('20000000-0000-4000-8000-000000000002');
    await post(
      '/api/v1/devices/register',
      off.body.accessToken,
      d2.registration('BENCHMARK simulator'),
    );
    await post(`/api/v1/devices/${d2.deviceId}/approve`, adm.body.accessToken, {});
    const lat: number[] = [];
    for (let b = 0; b < 20; b++) {
      const events = Array.from({ length: 50 }, () =>
        d2.location(16.302, 80.4555, 8, { dutySessionId: '30000000-0000-4000-8000-000000000002' }),
      );
      t = performance.now();
      const r = await post('/api/v1/sync/batch', off.body.accessToken, d2.batch(events));
      lat.push(performance.now() - t);
      if (r.body?.counts?.accepted !== 50)
        throw new Error(`unexpected batch result ${JSON.stringify(r.body).slice(0, 200)}`);
    }
    const s = stats(lat);
    results.batchIngestion50 = { ...s, eventsPerSecond: Math.round(50 / (s.meanMs / 1000)) };
  } else {
    results.batchIngestion50 = 'skipped (no --password)';
  }

  // 5. Independent verification of an exported package (if present)
  const pkgPath = arg('package');
  if (pkgPath) {
    const { readFileSync } = await import('node:fs');
    const zip = new Uint8Array(readFileSync(pkgPath));
    const v: number[] = [];
    for (let i = 0; i < 50; i++) {
      t = performance.now();
      verifyPackageZip(zip);
      v.push(performance.now() - t);
    }
    results.packageVerification = stats(v);
  }
  await pool.end();
  writeFileSync(OUT, JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
