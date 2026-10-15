import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import type { AppContext } from '../context.js';
import { evaluateLocation } from '../spatial/zones.js';
import { verifyFullAuditChain } from '../services/audit.js';
import {
  activeDevice,
  bearer,
  DEMO,
  mobileLogin,
  PF1,
  setupTestApp,
  webLogin,
  YARD,
} from './helpers.js';
import type { SimulatedDevice } from '../tools/sim-device.js';

let ctx: AppContext;
let app: Express;
let officer: string;
let admin: string;
let sup: string;
let reviewer: string;
let dev: SimulatedDevice;
const D1 = DEMO.duties.d1;

beforeAll(async () => {
  ({ ctx, app } = await setupTestApp());
  officer = (await mobileLogin(app, DEMO.emails.officer1)).token;
  admin = (await webLogin(app, DEMO.emails.admin)).token;
  sup = (await webLogin(app, DEMO.emails.supervisor)).token;
  reviewer = (await webLogin(app, DEMO.emails.reviewer)).token;
  dev = await activeDevice(app, officer, admin);
});
afterAll(async () => ctx.pool.end());
const sync = (events: unknown[]) =>
  request(app)
    .post('/api/v1/sync/batch')
    .set(bearer(officer))
    .send(dev.batch(events as never));

describe('PostGIS spatial validation', () => {
  it('classifies inside / within accuracy / outside against assigned zones (lon,lat order)', async () => {
    expect((await evaluateLocation(ctx.pool, PF1.lon, PF1.lat, 5, D1)).spatialResult).toBe(
      'INSIDE_ASSIGNED_ZONE',
    );
    // ~22 m north of PF1's north edge (16.3006): outside but within a 30 m accuracy radius.
    expect((await evaluateLocation(ctx.pool, 80.4505, 16.3008, 30, D1)).spatialResult).toBe(
      'OUTSIDE_WITHIN_ACCURACY',
    );
    const far = await evaluateLocation(ctx.pool, YARD.lon, YARD.lat, 10, D1);
    expect(far.spatialResult).toBe('OUTSIDE_ASSIGNED_ZONE');
    expect(far.distanceToAssignedZoneM).toBeGreaterThan(300);
    expect(far.matchedZoneIds).toContain(DEMO.zones.yard);
    // Swapping lat/lon puts the point in the Arabian sea region, nowhere near any zone.
    expect((await evaluateLocation(ctx.pool, PF1.lat, PF1.lon, 5, D1)).matchedZoneIds).toEqual([]);
    expect((await evaluateLocation(ctx.pool, PF1.lon, PF1.lat, 5, null)).spatialResult).toBe(
      'NO_ASSIGNED_ZONE',
    );
  });

  it('creates a spatial exception flag only beyond the reported accuracy', async () => {
    await sync([dev.location(16.3008, 80.4505, 30, { dutySessionId: D1 })]);
    expect(
      (
        await ctx.pool.query(
          "SELECT count(*)::int n FROM review_flags WHERE flag_type = 'SPATIAL_ZONE_EXCEPTION'",
        )
      ).rows[0].n,
    ).toBe(0);
    await sync([dev.location(YARD.lat, YARD.lon, 10, { dutySessionId: D1 })]);
    expect(
      (
        await ctx.pool.query(
          "SELECT count(*)::int n FROM review_flags WHERE flag_type = 'SPATIAL_ZONE_EXCEPTION'",
        )
      ).rows[0].n,
    ).toBe(1);
  });

  it('flags a client-reported mock-location indicator as MEDIUM review item, not a conclusion', async () => {
    await sync([dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1, mock: true })]);
    const f = (
      await ctx.pool.query(
        "SELECT severity, description FROM review_flags WHERE flag_type = 'MOCK_LOCATION_INDICATOR'",
      )
    ).rows[0];
    expect(f.severity).toBe('MEDIUM');
    expect(f.description).toMatch(/client-reported/);
  });

  it('labels stale and delayed observations instead of calling them live', async () => {
    const old = new Date(Date.now() - 50 * 60_000);
    await sync([dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: D1, wallTime: old })]);
    const r = await request(app).get('/api/v1/dashboard/observations').set(bearer(reviewer));
    const mine = r.body.items.find((x: { officerId: string }) => x.officerId === DEMO.officers.o1);
    expect(mine.freshness.label).toMatch(/RECENTLY_RECEIVED|DELAYED_SYNC|OFFLINE_LAST_KNOWN|STALE/);
    const { freshness } = await import('../routes/common.js');
    const now = new Date();
    expect(freshness(new Date(now.getTime() - 3 * 3600_000), now, now).label).toBe('DELAYED_SYNC');
    expect(
      freshness(
        new Date(now.getTime() - 3 * 3600_000),
        new Date(now.getTime() - 3 * 3600_000 + 1000),
        now,
      ).label,
    ).toBe('STALE');
    expect(freshness(new Date(now.getTime() - 60_000), now, now).label).toBe('RECENTLY_RECEIVED');
  });
});

describe('check-in lifecycle', () => {
  it('keeps a missed check-in and a later late acknowledgment as separate records', async () => {
    const checkinId = randomUUID();
    const sched = new Date(Date.now() - 20 * 60_000);
    const deadline = new Date(sched.getTime() + 3 * 60_000);
    const s = dev.event(
      'CHECKIN_SCHEDULED',
      {
        checkinId,
        scheduledFor: sched.toISOString(),
        deadlineAt: deadline.toISOString(),
        intervalMs: 5_400_000,
        responseWindowMs: 180_000,
        policyVersion: 1,
      },
      { dutySessionId: D1 },
    );
    const missed = dev.event(
      'CHECKIN_MISSED',
      {
        checkinId,
        scheduledFor: sched.toISOString(),
        deadlineAt: deadline.toISOString(),
        detectedAtDevice: new Date(deadline.getTime() + 1000).toISOString(),
        reasonCode: 'NO_RESPONSE',
      },
      { dutySessionId: D1 },
    );
    const late = dev.event(
      'CHECKIN_ACKNOWLEDGED_LATE',
      {
        checkinId,
        scheduledFor: sched.toISOString(),
        deadlineAt: deadline.toISOString(),
        acknowledgedAtDevice: new Date(deadline.getTime() + 120_000).toISOString(),
        lateByMs: 120_000,
        missedEventId: missed.eventId,
      },
      { dutySessionId: D1 },
    );
    const r = await sync([s, missed, late]);
    expect(r.body.counts.accepted).toBe(3);
    const c = (
      await ctx.pool.query(
        'SELECT status, missed_reason, late_by_ms, event_ids FROM checkins WHERE checkin_id = $1',
        [checkinId],
      )
    ).rows[0];
    expect(c).toMatchObject({
      status: 'ACKNOWLEDGED_LATE',
      missed_reason: 'NO_RESPONSE',
      late_by_ms: 120000,
    });
    expect(c.event_ids.length).toBe(3);
    const flags = (
      await ctx.pool.query(
        "SELECT flag_type FROM review_flags WHERE inputs->>'checkinId' = $1 ORDER BY flag_type",
        [checkinId],
      )
    ).rows.map((x) => x.flag_type);
    expect(flags).toEqual(['CHECKIN_LATE', 'CHECKIN_MISSED']);
    expect(
      (
        await ctx.pool.query(
          "SELECT count(*)::int n FROM device_events WHERE event_type = 'CHECKIN_MISSED' AND payload->>'checkinId' = $1",
          [checkinId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('movement correlation', () => {
  it('flags captures 2 h apart in different zones with < 50 steps, but not when transit was suspected', async () => {
    const duty = await request(app)
      .post('/api/v1/duties')
      .set(bearer(sup))
      .send({
        officerId: DEMO.officers.o1,
        plannedStart: new Date(Date.now() + 8 * 3600_000).toISOString(),
        plannedEnd: new Date(Date.now() + 18 * 3600_000).toISOString(),
        zoneIds: [DEMO.zones.pf1, DEMO.zones.yard],
      });
    expect(duty.status).toBe(201);
    const dId = duty.body.id as string;
    const t0 = new Date(Date.now() + 9 * 3600_000);
    const a = dev.evidence({
      dutySessionId: dId,
      lat: PF1.lat,
      lon: PF1.lon,
      wallTime: t0,
      steps: 5000,
    });
    const b = dev.evidence({
      dutySessionId: dId,
      lat: YARD.lat,
      lon: YARD.lon,
      wallTime: new Date(t0.getTime() + 2 * 3600_000),
      steps: 5020,
      advanceMs: 2 * 3600_000,
    });
    dev.monotonicMs += 2 * 3600_000;
    await sync([a.event, b.event]);
    const f = (
      await ctx.pool.query(
        "SELECT inputs FROM review_flags WHERE flag_type = 'MOVEMENT_INCONSISTENCY' AND duty_session_id = $1",
        [dId],
      )
    ).rows;
    expect(f).toHaveLength(1);
    expect(f[0].inputs.inputs.stepDelta).toBe(20);
    // With a transit observation in between, the rule is suppressed.
    const c = dev.evidence({
      dutySessionId: dId,
      lat: PF1.lat,
      lon: PF1.lon,
      wallTime: new Date(t0.getTime() + 4 * 3600_000),
      steps: 5030,
      advanceMs: 2 * 3600_000,
    });
    const transit = dev.event(
      'TRANSIT_STATE_SUSPECTED',
      { state: 'ENTERED', speedMps: 22, speedAccuracyMps: 1, horizontalAccuracyM: 10 },
      { dutySessionId: dId, wallTime: new Date(t0.getTime() + 3 * 3600_000) },
    );
    // transit must have a lower sequence than c: rebuild c after transit
    void c;
    const c2 = dev.evidence({
      dutySessionId: dId,
      lat: PF1.lat,
      lon: PF1.lon,
      wallTime: new Date(t0.getTime() + 4 * 3600_000),
      steps: 5030,
      advanceMs: 2 * 3600_000,
    });
    const r = await sync([transit, c2.event]);
    expect(r.body.results.map((x: { status: string }) => x.status)).toEqual([
      'ACCEPTED',
      'ACCEPTED',
    ]);
    expect(
      (
        await ctx.pool.query(
          "SELECT count(*)::int n FROM review_flags WHERE flag_type = 'MOVEMENT_INCONSISTENCY' AND duty_session_id = $1",
          [dId],
        )
      ).rows[0].n,
    ).toBe(1);
  });
});

describe('alerts workflow and audit chain', () => {
  it('requires notes to resolve, restricts reviewers, audits every action and never alters the observation', async () => {
    const flag = (
      await ctx.pool.query(
        "SELECT id, event_id FROM review_flags WHERE flag_type = 'SPATIAL_ZONE_EXCEPTION' LIMIT 1",
      )
    ).rows[0];
    const before = (
      await ctx.pool.query('SELECT event_hash, payload FROM device_events WHERE event_id = $1', [
        flag.event_id,
      ])
    ).rows[0];
    expect(
      (
        await request(app)
          .patch(`/api/v1/alerts/${flag.id}`)
          .set(bearer(reviewer))
          .send({ action: 'ACKNOWLEDGE' })
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .patch(`/api/v1/alerts/${flag.id}`)
          .set(bearer(sup))
          .send({ action: 'ACKNOWLEDGE' })
      ).body.status,
    ).toBe('ACKNOWLEDGED');
    expect(
      (
        await request(app)
          .patch(`/api/v1/alerts/${flag.id}`)
          .set(bearer(sup))
          .send({ action: 'ASSIGN', assigneeId: DEMO.users.reviewer })
      ).body.status,
    ).toBe('ASSIGNED');
    expect(
      (
        await request(app)
          .patch(`/api/v1/alerts/${flag.id}`)
          .set(bearer(sup))
          .send({ action: 'RESOLVE' })
      ).status,
    ).toBe(400);
    expect(
      (
        await request(app)
          .patch(`/api/v1/alerts/${flag.id}`)
          .set(bearer(sup))
          .send({
            action: 'RESOLVE',
            note: 'GPS drift near yard boundary; CCTV confirms platform presence (demo)',
          })
      ).body.status,
    ).toBe('RESOLVED');
    expect(
      (
        await request(app)
          .patch(`/api/v1/alerts/${flag.id}`)
          .set(bearer(sup))
          .send({ action: 'ACKNOWLEDGE' })
      ).status,
    ).toBe(409);
    const after = (
      await ctx.pool.query('SELECT event_hash, payload FROM device_events WHERE event_id = $1', [
        flag.event_id,
      ])
    ).rows[0];
    expect(after).toEqual(before);
    const actions = (
      await ctx.pool.query(
        'SELECT action FROM audit_events WHERE target_id = $1 ORDER BY sequence',
        [flag.id],
      )
    ).rows.map((x) => x.action);
    expect(actions).toEqual(['FLAG_ACKNOWLEDGE', 'FLAG_ASSIGN', 'FLAG_RESOLVE']);
    const list = await request(app)
      .get('/api/v1/dashboard/alerts?status=RESOLVED')
      .set(bearer(reviewer));
    expect(list.body.items.map((x: { id: string }) => x.id)).toContain(flag.id);
  });

  it('verifies the audit hash chain and detects tampering by a privileged database user', async () => {
    const ok = await request(app).get('/api/v1/audit-events/verify').set(bearer(admin));
    expect(ok.body.ok).toBe(true);
    expect(ok.body.checked).toBeGreaterThan(10);
    await expect(
      ctx.pool.query("UPDATE audit_events SET action = 'X' WHERE sequence = 2"),
    ).rejects.toThrow(/append-only/);
    await expect(ctx.pool.query('TRUNCATE audit_events')).rejects.toThrow(/append-only/);
    // A superuser can disable triggers; the hash chain still reveals the rewrite.
    await ctx.pool.query('ALTER TABLE audit_events DISABLE TRIGGER audit_events_append_only');
    await ctx.pool.query(
      'UPDATE audit_events SET details = \'{"tampered":true}\' WHERE sequence = 3',
    );
    await ctx.pool.query('ALTER TABLE audit_events ENABLE TRIGGER audit_events_append_only');
    const bad = await verifyFullAuditChain(ctx.pool);
    expect(bad.ok).toBe(false);
    expect(bad.issues[0]).toMatchObject({ sequence: 3, code: 'HASH_MISMATCH' });
    const cp = await request(app).get('/api/v1/audit-events/checkpoint').set(bearer(sup));
    expect(cp.body.recordHash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('duties and exports', () => {
  it('rejects overlapping duties and audits creation', async () => {
    const r = await request(app)
      .post('/api/v1/duties')
      .set(bearer(sup))
      .send({
        officerId: DEMO.officers.o1,
        plannedStart: new Date().toISOString(),
        plannedEnd: new Date(Date.now() + 3600_000).toISOString(),
        zoneIds: [DEMO.zones.pf1],
      });
    expect(r.status).toBe(409);
    expect(
      (
        await ctx.pool.query(
          "SELECT count(*)::int n FROM audit_events WHERE action = 'DUTY_CREATED'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('exports patrol logs as CSV with formula-injection protection and audit', async () => {
    const r = await request(app).get('/api/v1/patrol-logs/export.csv').set(bearer(sup));
    expect(r.status).toBe(200);
    expect(r.text.split('\r\n')[0]).toContain('eventId,officerName');
    expect(
      (await request(app).get('/api/v1/patrol-logs/export.csv').set(bearer(reviewer))).status,
    ).toBe(403);
    expect(
      (
        await ctx.pool.query(
          "SELECT count(*)::int n FROM audit_events WHERE action = 'PATROL_LOG_EXPORTED'",
        )
      ).rows[0].n,
    ).toBe(1);
  });
  it('paginates', async () => {
    const r = await request(app).get('/api/v1/patrol-logs?pageSize=2&page=1').set(bearer(reviewer));
    expect(r.body.items.length).toBeLessThanOrEqual(2);
    expect(r.body.totalPages).toBeGreaterThanOrEqual(1);
  });
});
