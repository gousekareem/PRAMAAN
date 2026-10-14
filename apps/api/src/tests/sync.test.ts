import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { computeEventHash } from '@pramaan/event-contracts';
import type { AppContext } from '../context.js';
import { SimulatedDevice } from '../tools/sim-device.js';
import { activeDevice, bearer, DEMO, mobileLogin, PF1, setupTestApp, webLogin } from './helpers.js';

let ctx: AppContext;
let app: Express;
let officer: string;
let admin: string;
const D1 = DEMO.duties.d1;

beforeAll(async () => {
  ({ ctx, app } = await setupTestApp());
  officer = (await mobileLogin(app, DEMO.emails.officer1)).token;
  admin = (await webLogin(app, DEMO.emails.admin)).token;
});
afterAll(async () => ctx.pool.end());

const sync = (body: object, token = officer) =>
  request(app).post('/api/v1/sync/batch').set(bearer(token)).send(body);
const count = async (sql: string, args: unknown[] = []) =>
  (await ctx.pool.query<{ n: number }>(sql, args)).rows[0]!.n;

describe('device lifecycle', () => {
  it('rejects events from pending, unknown and revoked devices', async () => {
    const dev = new SimulatedDevice(DEMO.officers.o1);
    const ev = dev.event(
      'DUTY_SESSION_STARTED',
      { assignedZoneIds: [], startedVia: 'APP' },
      { dutySessionId: D1 },
    );
    expect((await sync(dev.batch([ev]))).body.error.code).toBe('DEVICE_NOT_REGISTERED');
    await request(app)
      .post('/api/v1/devices/register')
      .set(bearer(officer))
      .send(dev.registration())
      .expect(201);
    expect((await sync(dev.batch([ev]))).body.error.code).toBe('DEVICE_NOT_APPROVED');
    const sup = (await webLogin(app, DEMO.emails.supervisor)).token;
    expect(
      (await request(app).post(`/api/v1/devices/${dev.deviceId}/approve`).set(bearer(sup))).status,
    ).toBe(403); // admin-only action
    await request(app)
      .post(`/api/v1/devices/${dev.deviceId}/approve`)
      .set(bearer(admin))
      .expect(200);
    expect((await sync(dev.batch([ev]))).body.results[0].status).toBe('ACCEPTED');
    await request(app)
      .post(`/api/v1/devices/${dev.deviceId}/revoke`)
      .set(bearer(admin))
      .send({ reason: 'Lost device (demo)' })
      .expect(200);
    const after = dev.event(
      'DUTY_SESSION_ENDED',
      { reason: 'OFFICER_ENDED' },
      { dutySessionId: D1 },
    );
    expect((await sync(dev.batch([after]))).body.error.code).toBe('DEVICE_REVOKED');
  });
  it('rejects malformed public keys and re-registration with a different key', async () => {
    const dev = new SimulatedDevice(DEMO.officers.o1);
    const bad = await request(app)
      .post('/api/v1/devices/register')
      .set(bearer(officer))
      .send({ ...dev.registration(), publicKeySpki: 'A'.repeat(120) });
    expect(bad.status).toBe(400);
    await request(app)
      .post('/api/v1/devices/register')
      .set(bearer(officer))
      .send(dev.registration())
      .expect(201);
    const other = new SimulatedDevice(DEMO.officers.o1, dev.deviceId);
    expect(
      (
        await request(app)
          .post('/api/v1/devices/register')
          .set(bearer(officer))
          .send(other.registration())
      ).status,
    ).toBe(409);
  });
});

describe('POST /api/v1/sync/batch', () => {
  it('accepts a valid signed batch and is idempotent on replay', async () => {
    const dev = await activeDevice(app, officer, admin);
    const events = [
      dev.event(
        'DUTY_SESSION_STARTED',
        { assignedZoneIds: [DEMO.zones.pf1], startedVia: 'APP' },
        { dutySessionId: D1 },
      ),
      dev.location(PF1.lat, PF1.lon, 6, { dutySessionId: D1 }),
      dev.location(PF1.lat, PF1.lon + 0.0002, 6, { dutySessionId: D1 }),
    ];
    const batch = dev.batch(events);
    const r = await sync(batch);
    expect(r.status).toBe(200);
    expect(r.body.counts).toEqual({ accepted: 3, duplicate: 0, rejected: 0, conflict: 0 });
    expect(r.body.chainHead).toEqual({ sequence: 3, eventHash: events[2]!.eventHash });
    expect(r.body.results[0].chainLinkStatus).toBe('GENESIS');
    // exact replay (e.g. response lost) → stored response, no duplicate rows
    const replay = await sync(batch);
    expect(replay.body.replayed).toBe(true);
    expect(
      await count('SELECT count(*)::int n FROM device_events WHERE device_id = $1', [dev.deviceId]),
    ).toBe(3);
    // same batchId with different content → 409
    const reused = await sync({ ...batch, events: [events[0]] });
    expect(reused.status).toBe(409);
    expect(reused.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    // same events in a new batch → DUPLICATE, still no duplicate rows
    const again = await sync(dev.batch(events));
    expect(again.body.results.map((x: { status: string }) => x.status)).toEqual([
      'DUPLICATE',
      'DUPLICATE',
      'DUPLICATE',
    ]);
    expect(
      await count('SELECT count(*)::int n FROM patrol_logs WHERE device_id = $1', [dev.deviceId]),
    ).toBe(3);
    const duty = (await ctx.pool.query('SELECT status FROM duty_sessions WHERE id = $1', [D1]))
      .rows[0];
    expect(duty.status).toBe('ACTIVE');
  });

  it('rejects modified events (hash mismatch) and preserves the rejected submission', async () => {
    const dev = await activeDevice(app, officer, admin);
    const e = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1 });
    const tampered = { ...e, payload: { ...e.payload, latitude: 16.4 } };
    const r = await sync(dev.batch([tampered]));
    expect(r.body.results[0]).toMatchObject({ status: 'REJECTED', code: 'EVENT_HASH_MISMATCH' });
    expect(
      await count('SELECT count(*)::int n FROM ingestion_rejections WHERE device_id = $1', [
        dev.deviceId,
      ]),
    ).toBe(1);
    expect(
      await count(
        "SELECT count(*)::int n FROM review_flags WHERE device_id = $1 AND flag_type = 'CHAIN_LINK_MISMATCH'",
        [dev.deviceId],
      ),
    ).toBe(1);
  });

  it('rejects forged client hashes that are re-computed but not signed by the device key', async () => {
    const dev = await activeDevice(app, officer, admin);
    const attacker = new SimulatedDevice(DEMO.officers.o1, dev.deviceId);
    const e = attacker.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1 });
    expect(computeEventHash(e)).toBe(e.eventHash); // internally consistent ...
    const r = await sync(dev.batch([e]));
    expect(r.body.results[0]).toMatchObject({ status: 'REJECTED', code: 'INVALID_SIGNATURE' }); // ... but not signed by the registered key
  });

  it('reports sequence gaps, accepts late fill, and rejects broken links', async () => {
    const dev = await activeDevice(app, officer, admin);
    const e1 = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1 });
    const e2 = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1 });
    const e3 = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1 });
    const r = await sync(dev.batch([e1, e3]));
    expect(r.body.results.map((x: { chainLinkStatus: string }) => x.chainLinkStatus)).toEqual([
      'GENESIS',
      'GAP_BEFORE',
    ]);
    expect(
      await count(
        "SELECT count(*)::int n FROM review_flags WHERE device_id = $1 AND flag_type = 'SEQUENCE_GAP'",
        [dev.deviceId],
      ),
    ).toBe(1);
    const fill = await sync(dev.batch([e2]));
    expect(fill.body.results[0]).toMatchObject({ status: 'ACCEPTED', chainLinkStatus: 'LINKED' });
    // An event whose previousEventHash does not match the stored predecessor is rejected.
    const e4 = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1 });
    const fork = dev.event('LOCATION_OBSERVED', e4.payload, { dutySessionId: D1 });
    fork.previousEventHash = 'f'.repeat(64);
    fork.eventHash = computeEventHash(fork);
    fork.deviceSignature = dev.signHash(fork.eventHash);
    const fr = await sync(dev.batch([e4, fork]));
    expect(fr.body.results[1]).toMatchObject({ status: 'REJECTED', code: 'CHAIN_LINK_MISMATCH' });
  });

  it('preserves conflicting duplicates instead of last-write-wins', async () => {
    const dev = await activeDevice(app, officer, admin);
    const e = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1 });
    await sync(dev.batch([e]));
    const changed = { ...e, payload: { ...e.payload, horizontalAccuracyM: 50 } };
    changed.eventHash = computeEventHash(changed);
    changed.deviceSignature = dev.signHash(changed.eventHash);
    const r = await sync(dev.batch([changed]));
    expect(r.body.results[0]).toMatchObject({ status: 'CONFLICT', code: 'CONFLICTING_DUPLICATE' });
    expect(
      await count('SELECT count(*)::int n FROM ingestion_conflicts WHERE event_id = $1', [
        e.eventId,
      ]),
    ).toBe(1);
    const stored = (
      await ctx.pool.query('SELECT event_hash FROM device_events WHERE event_id = $1', [e.eventId])
    ).rows[0];
    expect(stored.event_hash).toBe(e.eventHash); // original retained
    // Same sequence, different event id → SEQUENCE_CONFLICT
    const dup = { ...e, eventId: randomUUID() };
    dup.eventHash = computeEventHash(dup);
    dup.deviceSignature = dev.signHash(dup.eventHash);
    expect((await sync(dev.batch([dup]))).body.results[0].code).toBe('SEQUENCE_CONFLICT');
  });

  it('distinguishes invalid payloads, schema versions, duty and officer mismatches', async () => {
    const dev = await activeDevice(app, officer, admin);
    const badCoords = dev.location(123, 80.45, 5, { dutySessionId: D1 });
    const wrongDuty = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: DEMO.duties.d2 });
    const expired = dev.location(PF1.lat, PF1.lon, 5, {
      dutySessionId: D1,
      wallTime: new Date(Date.now() + 12 * 3600_000),
    });
    const r = await sync(dev.batch([badCoords, wrongDuty, expired]));
    expect(r.body.results.map((x: { code: string }) => x.code)).toEqual([
      'INVALID_PAYLOAD',
      'DUTY_SESSION_INVALID',
      'DUTY_SESSION_EXPIRED',
    ]);
    const v2 = dev.event('STEP_MILESTONE', { stepsSinceBoot: 10, stepsSinceDutyStart: 1 });
    const v2b = { ...v2, schemaVersion: 2 };
    v2b.eventHash = computeEventHash(v2b);
    v2b.deviceSignature = dev.signHash(v2b.eventHash);
    expect((await sync(dev.batch([v2b]))).body.results[0].code).toBe('UNSUPPORTED_SCHEMA_VERSION');
    expect((await sync({ ...dev.batch([v2]), schemaVersion: 9 })).status).toBe(422);
    const garbage = await sync(dev.batch([{ eventId: 'nope' } as never]));
    expect(garbage.body.results[0].code).toBe('INVALID_EVENT');
    const tooMany = await sync({ ...dev.batch([v2]), events: new Array(201).fill(v2) });
    expect(tooMany.status).toBe(400);
  });

  it('rolls back the whole batch on a server failure and accepts the identical retry', async () => {
    const dev = await activeDevice(app, officer, admin);
    await ctx.pool
      .query(`CREATE OR REPLACE FUNCTION test_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.horizontal_accuracy_m = 4321 THEN RAISE EXCEPTION 'simulated storage failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_fail BEFORE INSERT ON patrol_logs FOR EACH ROW EXECUTE FUNCTION test_fail();`);
    const batch = dev.batch([
      dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1 }),
      dev.location(PF1.lat, PF1.lon, 4321, { dutySessionId: D1 }),
    ]);
    const r = await sync(batch);
    expect(r.status).toBe(500);
    expect(r.body.error.code).toBe('INTERNAL_ERROR');
    expect(r.body.error.message).not.toContain('simulated'); // no internal detail leaked
    expect(
      await count('SELECT count(*)::int n FROM device_events WHERE device_id = $1', [dev.deviceId]),
    ).toBe(0);
    expect(
      await count('SELECT count(*)::int n FROM sync_batches WHERE batch_id = $1', [batch.batchId]),
    ).toBe(0);
    await ctx.pool.query('DROP TRIGGER test_fail ON patrol_logs; DROP FUNCTION test_fail();');
    const retry = await sync(batch);
    expect(retry.body.counts.accepted).toBe(2);
  });

  it('records clock anomalies and future timestamps as review flags without rewriting times', async () => {
    const dev = await activeDevice(app, officer, admin);
    const future = new Date(Date.now() + 60 * 60_000);
    const e = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1, wallTime: future });
    const c = dev.event(
      'CLOCK_ANOMALY_DETECTED',
      {
        anomalies: [
          {
            code: 'WALL_CLOCK_ROLLBACK',
            severity: 'WARNING',
            detail: 'Wall clock moved backwards',
            deltaMs: -3600000,
          },
        ],
      },
      { dutySessionId: D1 },
    );
    await sync(dev.batch([e, c]));
    expect(
      await count(
        "SELECT count(*)::int n FROM review_flags WHERE device_id = $1 AND flag_type = 'CLOCK_ANOMALY'",
        [dev.deviceId],
      ),
    ).toBe(2);
    const stored = (
      await ctx.pool.query(
        'SELECT device_wall_time, server_received_at FROM device_events WHERE event_id = $1',
        [e.eventId],
      )
    ).rows[0];
    expect(new Date(stored.device_wall_time).toISOString()).toBe(future.toISOString());
    expect(new Date(stored.server_received_at).getTime()).toBeLessThan(future.getTime());
  });

  it('device_events are append-only at the database level', async () => {
    await expect(ctx.pool.query("UPDATE device_events SET event_type = 'X'")).rejects.toThrow(
      /append-only/,
    );
    await expect(ctx.pool.query('DELETE FROM device_events')).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('TRUNCATE device_events CASCADE')).rejects.toThrow(/append-only/);
  });
});
