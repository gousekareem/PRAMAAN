import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AppContext } from '../context.js';
import { bearer, DEMO_ASSIGNMENTS, DEMO_PERSON, DEMO_UNITS, PF1, rankLogin, setupTestApp } from './helpers.js';
import { SimulatedDevice } from '../tools/sim-device.js';

let ctx: AppContext;
let app: Express;
let admin: string;
let si: string;
let pcMobile: string;
let dev: SimulatedDevice;
let session: string;
let incidentSession: string;
let incidentId: string;
let watchId: string;

const sync = (events: Parameters<SimulatedDevice['batch']>[0], batchId?: string) =>
  request(app).post('/api/v1/sync/batch').set(bearer(pcMobile)).send(dev.batch(events, batchId));

beforeAll(async () => {
  ({ ctx, app } = await setupTestApp());
  admin = (await rankLogin(app, 'admin')).token;
  si = (await rankLogin(app, 'si')).token;
  pcMobile = (await rankLogin(app, 'pc', 'mobile')).token;
  dev = new SimulatedDevice(DEMO_PERSON.pcg1!);
  await request(app).post('/api/v1/devices/register').set(bearer(pcMobile)).send(dev.registration()).expect(201);
  await request(app).post(`/api/v1/devices/${dev.deviceId}/approve`).set(bearer(admin)).send({}).expect(200);
  // A station watch running now (seeded duties are anchored to the IST calendar day, so tests that
  // sync device events create their own duty around the current time).
  const w = await request(app)
    .post('/api/v1/duty-assignments')
    .set(bearer(si))
    .send({
      category: 'STATION_WATCH',
      title: 'Presence test watch',
      stationUnitId: DEMO_UNITS.stationGuntur,
      unitId: DEMO_UNITS.stationGuntur,
      plannedStart: new Date(Date.now() - 20 * 60_000).toISOString(),
      plannedEnd: new Date(Date.now() + 4 * 3600_000).toISOString(),
      personnel: [{ officerId: DEMO_PERSON.pcg1 }],
      allowConflict: true,
      overrideReason: 'Test fixture overlaps the seeded station watch',
      publish: true,
    });
  expect(w.status, JSON.stringify(w.body)).toBe(201);
  watchId = w.body.id;
  const duties = await request(app).get('/api/v1/duties?pageSize=50').set(bearer(pcMobile));
  session = duties.body.items.find((d: { assignment: { id: string } | null }) => d.assignment?.id === watchId).id;
  // A restricted track-incident duty starting now with the same PC.
  const now = Date.now();
  const r = await request(app)
    .post('/api/v1/duty-assignments')
    .set(bearer(si))
    .send({
      category: 'TRACK_INCIDENT',
      title: 'Presence test incident',
      incidentRef: 'DEMO-INC-P1',
      unitId: DEMO_UNITS.stationGuntur,
      plannedStart: new Date(now - 10 * 60_000).toISOString(),
      plannedEnd: new Date(now + 3 * 3600_000).toISOString(),
      personnel: [{ officerId: DEMO_PERSON.pcg1 }],
      allowConflict: true,
      overrideReason: 'Test fixture overlaps the seeded station watch',
      publish: true,
    });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  incidentId = r.body.id;
  incidentSession = r.body.personnelHistory[0].dutySessionId;
});
afterAll(async () => ctx.pool.end());

describe('duty-linked check-ins', () => {
  it('device duty start moves the assignment to IN_PROGRESS and keeps device time separate from server time', async () => {
    const deviceTime = new Date(Date.now() - 5 * 60_000);
    const r = await sync([
      dev.event('DUTY_SESSION_STARTED', { assignedZoneIds: [], startedVia: 'APP' }, { dutySessionId: session, wallTime: deviceTime }),
    ]);
    expect(r.body.counts.accepted).toBe(1);
    const d = (await request(app).get(`/api/v1/duty-assignments/${watchId}`).set(bearer(si))).body;
    expect(d.status).toBe('IN_PROGRESS');
    const me = d.personnelHistory.find((p: { officerId: string }) => p.officerId === DEMO_PERSON.pcg1);
    expect(new Date(me.deviceReportedStart).toISOString()).toBe(deviceTime.toISOString());
    expect(new Date(me.serverReceivedStart).getTime()).toBeGreaterThan(deviceTime.getTime());
    const change = d.changes.find((c: { changeType: string; after: { status: string } | null }) => c.changeType === 'STATUS_CHANGED' && c.after?.status === 'IN_PROGRESS');
    expect(change.reason).toMatch(/not proof of physical attendance/);
  });

  it('links each check-in to the personnel record and the duty', async () => {
    const checkinId = randomUUID();
    const sched = new Date(Date.now() - 4 * 60_000);
    const deadline = new Date(sched.getTime() + 180_000);
    const r = await sync([
      dev.event('CHECKIN_SCHEDULED', { checkinId, scheduledFor: sched.toISOString(), deadlineAt: deadline.toISOString(), intervalMs: 5_400_000, responseWindowMs: 180_000, policyVersion: 1 }, { dutySessionId: session }),
      dev.location(PF1.lat, PF1.lon, 8, { dutySessionId: session }),
      dev.event('CHECKIN_ACKNOWLEDGED', { checkinId, scheduledFor: sched.toISOString(), deadlineAt: deadline.toISOString(), acknowledgedAtDevice: new Date(sched.getTime() + 40_000).toISOString(), responseMs: 40_000 }, { dutySessionId: session }),
    ]);
    expect(r.body.counts.accepted).toBe(3);
    const list = await request(app).get(`/api/v1/checkins?assignmentId=${watchId}`).set(bearer(si));
    const k = list.body.items.find((x: { checkinId: string }) => x.checkinId === checkinId);
    expect(k).toMatchObject({ officerId: DEMO_PERSON.pcg1, dutyReference: expect.stringContaining('SW-'), dutyCategory: 'STATION_WATCH', status: 'ACKNOWLEDGED' });
    expect(k.serverReceivedAt).toBeTruthy();
    expect(k.scheduledForDevice).toBeTruthy();
    // The field user sees their own check-in; another field user does not.
    const own = await request(app).get('/api/v1/checkins').set(bearer((await rankLogin(app, 'pc')).token));
    expect(own.body.items.some((x: { checkinId: string }) => x.checkinId === checkinId)).toBe(true);
    const other = await request(app).get('/api/v1/checkins').set(bearer((await rankLogin(app, 'hg')).token));
    expect(other.body.items.some((x: { checkinId: string }) => x.checkinId === checkinId)).toBe(false);
  });

  it('events recorded offline sync later without duplicates, even when a batch is replayed', async () => {
    const offline = Array.from({ length: 5 }, (_, i) =>
      dev.location(PF1.lat, PF1.lon + i * 0.00005, 9, { dutySessionId: session, wallTime: new Date(Date.now() - (40 - i) * 60_000) }),
    );
    const batchId = randomUUID();
    const first = await sync(offline, batchId);
    expect(first.body.counts.accepted).toBe(5);
    const replay = await sync(offline, batchId);
    expect(replay.body.replayed).toBe(true);
    const n = await ctx.pool.query('SELECT count(*)::int n FROM device_events WHERE event_id = ANY($1::uuid[])', [offline.map((e) => e.eventId)]);
    expect(n.rows[0].n).toBe(5);
    const again = await sync(offline); // same events, new batch id
    expect(again.body.counts.duplicate).toBe(5);
  });
});

describe('evidence on a restricted duty', () => {
  let evidenceId: string;
  let image: Buffer;
  it('accepts in-app evidence linked to the duty and verifies the SHA-256', async () => {
    await sync([dev.event('DUTY_SESSION_STARTED', { assignedZoneIds: [], startedVia: 'APP' }, { dutySessionId: incidentSession })]);
    const ev = dev.evidence({ dutySessionId: incidentSession, lat: PF1.lat, lon: PF1.lon });
    evidenceId = ev.evidenceId;
    image = ev.image;
    expect((await sync([ev.event])).body.counts.accepted).toBe(1);
    const up = await request(app)
      .put(`/api/v1/sync/evidence/${evidenceId}`)
      .set(bearer(pcMobile))
      .attach('file', image, { filename: 'c.jpg', contentType: 'image/jpeg' });
    expect(up.body.status).toBe('VERIFIED');
    const d = (await request(app).get(`/api/v1/duty-assignments/${incidentId}`).set(bearer(si))).body;
    expect(d.evidence.map((e: { evidenceId: string }) => e.evidenceId)).toContain(evidenceId);
  });

  it('restricts evidence metadata and images to authorised users', async () => {
    const siEv = await request(app).get(`/api/v1/evidence/${evidenceId}`).set(bearer(si));
    expect(siEv.status).toBe(200);
    expect(siEv.body.assignment.category).toBe('TRACK_INCIDENT');
    expect((await request(app).get(`/api/v1/evidence/${evidenceId}/content`).set(bearer(si))).status).toBe(200);
    for (const k of ['hc', 'asi', 'dsp'] as const) {
      const t = (await rankLogin(app, k)).token;
      expect((await request(app).get(`/api/v1/evidence/${evidenceId}`).set(bearer(t))).status, k).toBe(404);
      const list = await request(app).get('/api/v1/evidence?pageSize=100').set(bearer(t));
      expect(list.body.items.some((e: { evidenceId: string }) => e.evidenceId === evidenceId), k).toBe(false);
    }
    const hg = (await rankLogin(app, 'hg')).token;
    expect((await request(app).get(`/api/v1/evidence/${evidenceId}/content`).set(bearer(hg))).status).toBe(403);
    expect((await request(app).get(`/api/v1/evidence/${evidenceId}/package`).set(bearer(hg))).status).toBe(403);
    // The capturing PC can see their own metadata but not download images or packages.
    const pcWeb = (await rankLogin(app, 'pc')).token;
    expect((await request(app).get(`/api/v1/evidence/${evidenceId}`).set(bearer(pcWeb))).status).toBe(200);
    expect((await request(app).get(`/api/v1/evidence/${evidenceId}/content`).set(bearer(pcWeb))).status).toBe(403);
    const views = await ctx.pool.query("SELECT count(*)::int n FROM audit_events WHERE evidence_id = $1 AND action = 'EVIDENCE_CONTENT_VIEWED'", [evidenceId]);
    expect(views.rows[0].n).toBe(1);
  });

  it('modified evidence fails verification and the exception is linked to the duty', async () => {
    const ev = dev.evidence({ dutySessionId: incidentSession, lat: PF1.lat, lon: PF1.lon });
    await sync([ev.event]);
    const tampered = Buffer.from(ev.image);
    tampered[tampered.length - 10] = (tampered[tampered.length - 10]! + 1) % 256;
    const up = await request(app)
      .put(`/api/v1/sync/evidence/${ev.evidenceId}`)
      .set(bearer(pcMobile))
      .attach('file', tampered, { filename: 'c.jpg', contentType: 'image/jpeg' });
    expect(up.status).toBe(422);
    const row = await ctx.pool.query('SELECT status FROM evidence_objects WHERE evidence_id = $1', [ev.evidenceId]);
    expect(row.rows[0].status).not.toBe('VERIFIED');
    const flag = await ctx.pool.query("SELECT duty_assignment_id FROM review_flags WHERE evidence_id = $1 AND flag_type = 'EVIDENCE_HASH_MISMATCH'", [ev.evidenceId]);
    expect(flag.rows[0].duty_assignment_id).toBe(incidentId);
    const rep = await request(app).get('/api/v1/reports/evidence-verification.csv').set(bearer(si));
    expect(rep.text).toContain(ev.evidenceId);
  });

  it('a field user’s personal summary shows server-side sync and evidence status', async () => {
    const pcWeb = (await rankLogin(app, 'pc')).token;
    const s = await request(app).get('/api/v1/me/summary').set(bearer(pcWeb));
    expect(s.status).toBe(200);
    expect(s.body.devices[0].lastSyncAt).toBeTruthy();
    expect(s.body.evidence.verified).toBeGreaterThanOrEqual(1);
    expect(s.body.duties.map((d: { id: string }) => d.id)).toContain(DEMO_ASSIGNMENTS.swTodayMorning);
  });
});
