import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AppContext } from '../context.js';
import { bearer, DEMO_ASSIGNMENTS, DEMO_PERSON, DEMO_UNITS, rankLogin, setupTestApp } from './helpers.js';
import { istMidnight } from '../database/demo-operations.js';
import { evaluateDutyExceptions } from '../services/exceptions.js';

let ctx: AppContext;
let app: Express;
let si: string;
let ci: string;
let hc: string;
let admin: string;
let pc: string;
let pcAr: string;
const day0 = istMidnight(new Date());
const at = (day: number, hh: number, mm = 0) => new Date(day0.getTime() + day * 86_400_000 + (hh * 60 + mm) * 60_000).toISOString();

beforeAll(async () => {
  ({ ctx, app } = await setupTestApp());
  si = (await rankLogin(app, 'si')).token;
  ci = (await rankLogin(app, 'ci')).token;
  hc = (await rankLogin(app, 'hc')).token;
  admin = (await rankLogin(app, 'admin')).token;
  pc = (await rankLogin(app, 'pc')).token;
  pcAr = (await rankLogin(app, 'pc.ar')).token;
});
afterAll(async () => ctx.pool.end());

const create = (token: string, body: Record<string, unknown>) =>
  request(app).post('/api/v1/duty-assignments').set(bearer(token)).send(body);

describe('four duty categories', () => {
  it('an authorised SI can create and view every category with flexible staffing', async () => {
    const cases: Record<string, unknown>[] = [
      { category: 'TRAIN_BEAT', title: 'Test beat — two AR constables', trainRef: 'DEMO-TRN-T1', personnel: [{ officerId: DEMO_PERSON.pca2 }, { officerId: DEMO_PERSON.pca4 }] },
      { category: 'TRAIN_BEAT', title: 'Test beat — two General constables', personnel: [{ officerId: DEMO_PERSON.pcg5 }, { officerId: DEMO_PERSON.pcg2 }] },
      { category: 'STATION_WATCH', title: 'Test watch — HG only', stationUnitId: DEMO_UNITS.stationGuntur, personnel: [{ officerId: DEMO_PERSON.hg4 }] },
      { category: 'VIP_ESCORT', title: 'Test escort — mixed', escortLabel: 'DEMO-VIP-T', personnel: [{ officerId: DEMO_PERSON.hg2 }, { officerId: DEMO_PERSON.pcg1 }, { officerId: DEMO_PERSON.pca1 }] },
      { category: 'TRACK_INCIDENT', title: 'Test incident response', incidentRef: 'DEMO-INC-T1', personnel: [{ officerId: DEMO_PERSON.hc1, roleInDuty: 'LEAD' }] },
    ];
    let day = 5;
    for (const c of cases) {
      const r = await create(si, { unitId: DEMO_UNITS.stationGuntur, plannedStart: at(day, 8), plannedEnd: at(day, 14), publish: true, ...c });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.status).toBe('ASSIGNED');
      expect(r.body.personnel.length).toBe((c.personnel as unknown[]).length);
      expect(r.body.referenceCode).toMatch(/^(TB|SW|VE|TI)-\d{8}-\d{3}$/);
      const got = await request(app).get(`/api/v1/duty-assignments/${r.body.id}`).set(bearer(si));
      expect(got.status).toBe(200);
      day++;
    }
    for (const cat of ['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT']) {
      const l = await request(app).get(`/api/v1/duty-assignments?category=${cat}&pageSize=100`).set(bearer(si));
      expect(l.body.items.length, cat).toBeGreaterThan(0);
      expect(l.body.items.every((a: { category: string }) => a.category === cat)).toBe(true);
    }
  });

  it('enforces the category-specific reference fields', async () => {
    const base = { unitId: DEMO_UNITS.stationGuntur, plannedStart: at(12, 8), plannedEnd: at(12, 10) };
    expect((await create(si, { ...base, category: 'VIP_ESCORT', title: 'No label' })).status).toBe(400);
    expect((await create(si, { ...base, category: 'TRACK_INCIDENT', title: 'No ref' })).status).toBe(400);
    expect((await create(si, { ...base, category: 'STATION_WATCH', title: 'No station' })).status).toBe(400);
    const long = await create(si, { ...base, category: 'TRAIN_BEAT', title: 'Too long', plannedEnd: at(13, 8) });
    expect(long.status).toBe(400);
  });

  it('a single person is a valid assignment and staffing gaps are warnings, not rejections', async () => {
    const r = await create(si, { category: 'TRACK_INCIDENT', title: 'Single person incident', incidentRef: 'DEMO-INC-T2', unitId: DEMO_UNITS.stationGuntur, plannedStart: at(14, 8), plannedEnd: at(14, 12), personnel: [{ officerId: DEMO_PERSON.hg1 }] });
    expect(r.status).toBe(201);
    expect(r.body.warnings.join(' ')).toMatch(/supervising officer/);
    expect(r.body.warnings.join(' ')).toMatch(/instructions/);
  });
});

describe('assignment rules', () => {
  let draft: string;
  beforeAll(async () => {
    const r = await create(si, { category: 'TRAIN_BEAT', title: 'Rules test beat', unitId: DEMO_UNITS.stationGuntur, plannedStart: at(0, 9), plannedEnd: at(0, 15) });
    draft = r.body.id;
  });

  it('detects overlapping assignments and requires an authorised, reasoned override', async () => {
    // Vemuri Anil Kumar is on the seeded train beat today 08:00–16:00.
    const r = await request(app).post(`/api/v1/duty-assignments/${draft}/personnel`).set(bearer(si)).send({ officerId: DEMO_PERSON.pca1 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ASSIGNMENT_CONFLICT');
    expect(r.body.error.details.conflicts[0].type).toBe('ASSIGNMENT');
    const noReason = await request(app).post(`/api/v1/duty-assignments/${draft}/personnel`).set(bearer(si)).send({ officerId: DEMO_PERSON.pca1, allowConflict: true });
    expect(noReason.status).toBe(400);
    const ok = await request(app)
      .post(`/api/v1/duty-assignments/${draft}/personnel`)
      .set(bearer(si))
      .send({ officerId: DEMO_PERSON.pca1, allowConflict: true, overrideReason: 'Short relief before the beat ends' });
    expect(ok.status).toBe(201);
    const flag = await ctx.pool.query("SELECT duty_assignment_id FROM review_flags WHERE flag_type = 'ASSIGNMENT_CONFLICT' AND officer_id = $1", [DEMO_PERSON.pca1]);
    expect(flag.rows.map((x) => x.duty_assignment_id)).toContain(draft);
    const roster = await request(app).get(`/api/v1/roster?from=${at(0, 0)}&to=${at(1, 0)}`).set(bearer(si));
    expect(roster.body.conflicts.some((c: { officerId: string; kind: string }) => c.officerId === DEMO_PERSON.pca1 && c.kind === 'OVERLAPPING_DUTIES')).toBe(true);
  });

  it('flags leave/unavailability conflicts', async () => {
    const r = await create(si, { category: 'STATION_WATCH', title: 'During leave', stationUnitId: DEMO_UNITS.stationGuntur, unitId: DEMO_UNITS.stationGuntur, plannedStart: at(2, 9), plannedEnd: at(2, 12), personnel: [{ officerId: DEMO_PERSON.pca2 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.details.conflicts[0].type).toBe('UNAVAILABLE');
  });

  it('rejects newly assigning inactive personnel', async () => {
    const r = await request(app).post(`/api/v1/duty-assignments/${draft}/personnel`).set(bearer(si)).send({ officerId: DEMO_PERSON.pcx });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('INACTIVE_PERSONNEL');
  });

  it('applies configurable eligibility (BLOCK or WARN), never a hard-coded combination', async () => {
    const body = { reason: 'test eligibility configuration', eligible: ['PC_AR', 'PC_GENERAL', 'PC', 'HC', 'ASI', 'SI'] };
    await request(app).patch('/api/v1/policy/duty-categories/TRACK_INCIDENT').set(bearer(admin)).send(body).expect(200);
    const blocked = await create(si, { category: 'TRACK_INCIDENT', title: 'HG not eligible', incidentRef: 'DEMO-INC-T3', unitId: DEMO_UNITS.stationGuntur, plannedStart: at(15, 8), plannedEnd: at(15, 12), personnel: [{ officerId: DEMO_PERSON.hg2 }] });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe('NOT_ELIGIBLE');
    await request(app).patch('/api/v1/policy/duty-categories/TRACK_INCIDENT').set(bearer(admin)).send({ eligibilityMode: 'WARN', reason: 'test warn mode' }).expect(200);
    const warned = await create(si, { category: 'TRACK_INCIDENT', title: 'HG with warning', incidentRef: 'DEMO-INC-T4', unitId: DEMO_UNITS.stationGuntur, plannedStart: at(15, 8), plannedEnd: at(15, 12), personnel: [{ officerId: DEMO_PERSON.hg2 }] });
    expect(warned.status).toBe(201);
    expect(warned.body.creationWarnings.join(' ')).toMatch(/outside the configured eligibility/);
    await request(app)
      .patch('/api/v1/policy/duty-categories/TRACK_INCIDENT')
      .set(bearer(admin))
      .send({ eligibilityMode: 'BLOCK', eligible: ['HG', 'PC_AR', 'PC_GENERAL', 'PC', 'HC', 'ASI', 'SI'], reason: 'restore defaults' })
      .expect(200);
    const sv = await request(app).patch('/api/v1/policy/duty-categories/TRACK_INCIDENT').set(bearer(si)).send({ graceMin: 1, reason: 'not allowed' });
    expect(sv.status).toBe(403);
  });

  it('rejects invalid status transitions', async () => {
    const empty = await create(si, { category: 'TRAIN_BEAT', title: 'Empty duty', unitId: DEMO_UNITS.stationGuntur, plannedStart: at(16, 8), plannedEnd: at(16, 10) });
    const st = (to: string, extra: Record<string, unknown> = {}, token = si) =>
      request(app).post(`/api/v1/duty-assignments/${empty.body.id}/status`).set(bearer(token)).send({ to, ...extra });
    expect((await st('COMPLETED', { completionNote: 'cannot complete a draft' })).body.error.code).toBe('INVALID_TRANSITION');
    expect((await st('ASSIGNED')).body.error.code).toBe('INVALID_TRANSITION'); // nobody assigned
    expect((await st('CANCELLED')).status).toBe(400); // reason required
    expect((await st('CANCELLED', { reason: 'not needed any more' })).status).toBe(200);
    expect((await st('ASSIGNED')).body.error.code).toBe('INVALID_TRANSITION'); // terminal
  });

  it('rejects unauthorised modifications', async () => {
    expect((await request(app).post(`/api/v1/duty-assignments/${draft}/personnel`).set(bearer(hc)).send({ officerId: DEMO_PERSON.hg1 })).status).toBe(403);
    expect((await request(app).post(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.swTodayMorning}/status`).set(bearer(pc)).send({ to: 'COMPLETED', completionNote: 'assigned but not authorised to close' })).status).toBe(403);
    expect((await request(app).patch(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.swNarasaraopetTomorrow}`).set(bearer(si)).send({ title: 'out of scope', reason: 'should fail' })).status).toBe(404);
    // A duty the PC is not on is simply not visible (404) — no existence leak.
    expect((await request(app).post(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.tbToday}/status`).set(bearer(pc)).send({ to: 'COMPLETED', completionNote: 'not mine' })).status).toBe(404);
    expect((await create(hc, { category: 'TRAIN_BEAT', title: 'HC cannot create', unitId: DEMO_UNITS.stationGuntur, plannedStart: at(17, 8), plannedEnd: at(17, 10) })).status).toBe(403);
    const otherUnit = await create(si, { category: 'TRAIN_BEAT', title: 'Unit outside scope', unitId: DEMO_UNITS.stationNarasaraopet, plannedStart: at(17, 8), plannedEnd: at(17, 10) });
    expect(otherUnit.status).toBe(403);
  });
});

describe('history-preserving changes', () => {
  it('replacement, removal and schedule changes keep the original record with reason, actor and time', async () => {
    const r = await create(si, { category: 'STATION_WATCH', title: 'Replacement test', stationUnitId: DEMO_UNITS.stationGuntur, unitId: DEMO_UNITS.stationGuntur, plannedStart: at(20, 6), plannedEnd: at(20, 14), publish: true, personnel: [{ officerId: DEMO_PERSON.hg1 }, { officerId: DEMO_PERSON.pcg1 }] });
    const id = r.body.id as string;
    const hgRow = r.body.personnel.find((p: { officerId: string }) => p.officerId === DEMO_PERSON.hg1);
    const sessionBefore = r.body.personnelHistory.find((p: { personnelId: string }) => p.personnelId === hgRow.personnelId).dutySessionId;
    const rep = await request(app)
      .post(`/api/v1/duty-assignments/${id}/personnel/${hgRow.personnelId}/replace`)
      .set(bearer(si))
      .send({ officerId: DEMO_PERSON.hg4, reason: 'Original HG requested shift swap' });
    expect(rep.status).toBe(200);
    const sched = await request(app).patch(`/api/v1/duty-assignments/${id}`).set(bearer(si)).send({ plannedStart: at(20, 7), plannedEnd: at(20, 15) });
    expect(sched.status).toBe(400); // reason required once published
    const sched2 = await request(app).patch(`/api/v1/duty-assignments/${id}`).set(bearer(si)).send({ plannedStart: at(20, 7), plannedEnd: at(20, 15), reason: 'Train timing revised' });
    expect(sched2.status).toBe(200);
    const d = (await request(app).get(`/api/v1/duty-assignments/${id}`).set(bearer(si))).body;
    const old = d.personnelHistory.find((p: { personnelId: string }) => p.personnelId === hgRow.personnelId);
    expect(old.status).toBe('REPLACED');
    expect(old.removalReason).toBe('Original HG requested shift swap');
    expect(d.changes.map((c: { changeType: string }) => c.changeType)).toEqual(
      expect.arrayContaining(['CREATED', 'PERSONNEL_ADDED', 'STATUS_CHANGED', 'PERSONNEL_REPLACED', 'SCHEDULE_CHANGED']),
    );
    const sc = d.changes.find((c: { changeType: string }) => c.changeType === 'SCHEDULE_CHANGED');
    expect(sc.before.plannedStart).toBe(at(20, 6));
    expect(sc.after.plannedStart).toBe(at(20, 7));
    expect(sc.reason).toBe('Train timing revised');
    const sess = await ctx.pool.query('SELECT status FROM duty_sessions WHERE id = $1', [sessionBefore]);
    expect(sess.rows[0].status).toBe('CANCELLED');
    // Change history is append-only.
    await expect(ctx.pool.query('UPDATE duty_assignment_changes SET reason = $1 WHERE assignment_id = $2', ['edited', id])).rejects.toThrow(/append-only/);
    // Audit chain remains consistent after all assignment changes.
    const v = await request(app).get('/api/v1/audit-events/verify').set(bearer(admin));
    expect(v.body.ok).toBe(true);
  });

  it('versioned instructions with acknowledgement by assigned personnel only', async () => {
    const d = (await request(app).get(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.tbToday}`).set(bearer(pcAr))).body;
    expect(d.instructions.map((i: { version: number }) => i.version)).toEqual([2, 1]);
    const v2 = d.instructions[0];
    expect(v2.acknowledgements.length).toBe(0);
    await request(app).post(`/api/v1/duty-assignments/instructions/${v2.id}/acknowledge`).set(bearer(pcAr)).expect(200);
    expect((await request(app).post(`/api/v1/duty-assignments/instructions/${v2.id}/acknowledge`).set(bearer(pc))).status).toBe(404);
    const pub = await request(app).post(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.tbToday}/instructions`).set(bearer(pc)).send({ body: 'not allowed' });
    expect(pub.status).toBe(403);
    await expect(ctx.pool.query('UPDATE duty_instructions SET body = $1 WHERE id = $2', ['changed', v2.id])).rejects.toThrow(/append-only/);
  });

  it('acceptance by every assigned person moves the duty to ACCEPTED', async () => {
    const r = await create(si, { category: 'VIP_ESCORT', title: 'Acceptance test', escortLabel: 'DEMO-VIP-ACC', unitId: DEMO_UNITS.stationGuntur, plannedStart: at(21, 9), plannedEnd: at(21, 12), publish: true, personnel: [{ officerId: DEMO_PERSON.pca1 }, { officerId: DEMO_PERSON.pcg1 }] });
    expect(r.body.acceptRequired).toBe(true);
    await request(app).post(`/api/v1/duty-assignments/${r.body.id}/accept`).set(bearer(pcAr)).expect(200);
    const last = await request(app).post(`/api/v1/duty-assignments/${r.body.id}/accept`).set(bearer(pc));
    expect(last.body.assignmentStatus).toBe('ACCEPTED');
    expect((await request(app).post(`/api/v1/duty-assignments/${r.body.id}/accept`).set(bearer(pc))).status).toBe(409);
  });

  it('records a handover and lets the involved personnel acknowledge it', async () => {
    const d = (await request(app).get(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.swTodayMorning}`).set(bearer(pc))).body;
    expect(d.handovers.length).toBe(1);
    const hid = d.handovers[0].id;
    const ack = await request(app).post(`/api/v1/duty-assignments/handovers/${hid}/acknowledge`).set(bearer(pc));
    expect(ack.body.side).toBe('OUTGOING');
    expect((await request(app).post(`/api/v1/duty-assignments/handovers/${hid}/acknowledge`).set(bearer(pcAr))).status).toBe(404);
    // A PC can record a handover only as the outgoing person.
    const bad = await request(app)
      .post(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.swTodayMorning}/handovers`)
      .set(bearer(pc))
      .send({ outgoingOfficerId: DEMO_PERSON.hg1, incomingOfficerId: DEMO_PERSON.hg4, handoverAt: at(0, 13) });
    expect(bad.status).toBe(403);
  });

  it('notifications are QUEUED until the recipient retrieves them', async () => {
    const r = await create(si, { category: 'TRAIN_BEAT', title: 'Notify test', unitId: DEMO_UNITS.stationGuntur, plannedStart: at(22, 8), plannedEnd: at(22, 10), publish: true, personnel: [{ officerId: DEMO_PERSON.hg1 }] });
    const q = await ctx.pool.query(
      "SELECT delivery_status FROM notifications n JOIN app_users u ON u.id = n.recipient_user_id WHERE u.email = 'hg@parmaan.demo' AND n.related_id = $1",
      [r.body.id],
    );
    expect(q.rows.map((x) => x.delivery_status)).toEqual(['QUEUED']);
    const hg = (await rankLogin(app, 'hg')).token;
    const inbox = await request(app).get('/api/v1/notifications').set(bearer(hg));
    const n = inbox.body.items.find((x: { relatedId: string }) => x.relatedId === r.body.id);
    expect(n.deliveryStatus).toBe('DELIVERED');
    await request(app).post(`/api/v1/notifications/${n.id}/read`).set(bearer(hg)).expect(200);
    expect((await request(app).post(`/api/v1/notifications/${n.id}/read`).set(bearer(pc))).status).toBe(404);
  });
});

describe('exceptions and corrections', () => {
  it('raises reporting-delay and overdue exceptions idempotently, and never as misconduct', async () => {
    const start = new Date(Date.now() - 3 * 3600_000);
    const r = await create(si, { category: 'TRAIN_BEAT', title: 'Late reporting test', unitId: DEMO_UNITS.stationGuntur, plannedStart: start.toISOString(), plannedEnd: new Date(Date.now() - 30 * 60_000).toISOString(), publish: true, personnel: [{ officerId: DEMO_PERSON.pcg5 }], allowConflict: true, overrideReason: 'test fixture overlap' });
    expect(r.status).toBe(201);
    const first = await evaluateDutyExceptions(ctx.pool, null);
    expect(first.reportingDelayed).toBeGreaterThan(0);
    expect(first.overdue).toBeGreaterThan(0);
    const again = await evaluateDutyExceptions(ctx.pool, null);
    expect(again.reportingDelayed + again.overdue).toBe(0);
    const flags = await ctx.pool.query("SELECT flag_type, description FROM review_flags WHERE duty_assignment_id = $1 ORDER BY flag_type", [r.body.id]);
    expect(flags.rows.map((f) => f.flag_type)).toEqual(expect.arrayContaining(['DUTY_OVERDUE', 'DUTY_REPORTING_DELAYED']));
    expect(flags.rows.map((f) => f.description).join(' ')).not.toMatch(/misconduct(?!\.)/i);
    // Supervisors can annotate; viewers without exception.manage cannot.
    const f = (await request(app).get(`/api/v1/dashboard/alerts?assignmentId=${r.body.id}`).set(bearer(si))).body.items[0];
    await request(app).post(`/api/v1/exceptions/${f.id}/notes`).set(bearer(si)).send({ note: 'Called the constable; device battery failed.' }).expect(201);
    expect((await request(app).post(`/api/v1/exceptions/${f.id}/notes`).set(bearer(hc)).send({ note: 'not allowed' })).status).toBe(403);
    await request(app).patch(`/api/v1/alerts/${f.id}`).set(bearer(si)).send({ action: 'RESOLVE', note: 'Explained; device failure confirmed.' }).expect(200);
    const detail = await request(app).get(`/api/v1/exceptions/${f.id}`).set(bearer(si));
    expect(detail.body.notes.length).toBe(1);
    expect(detail.body.history.map((h: { action: string }) => h.action)).toEqual(expect.arrayContaining(['FLAG_NOTE_ADDED', 'FLAG_RESOLVE']));
    const pcView = await request(app).get(`/api/v1/exceptions/${f.id}`).set(bearer(pc));
    expect(pcView.status).toBe(403);
  });

  it('corrections never overwrite the original and need a different approver', async () => {
    const d = (await request(app).get(`/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.swTodayMorning}`).set(bearer(pc))).body;
    const mine = d.personnelHistory.find((p: { officerId: string }) => p.officerId === DEMO_PERSON.pcg1);
    const req0 = await request(app)
      .post('/api/v1/corrections')
      .set(bearer(pc))
      .send({ targetType: 'DUTY_PERSONNEL', targetId: mine.personnelId, fieldName: 'reported_start', correctedValue: at(0, 6, 5), reason: 'Phone was off at the start of the shift' });
    expect(req0.status).toBe(201);
    const notMine = d.personnelHistory.find((p: { officerId: string }) => p.officerId === DEMO_PERSON.hg1);
    expect((await request(app).post('/api/v1/corrections').set(bearer(pc)).send({ targetType: 'DUTY_PERSONNEL', targetId: notMine.personnelId, fieldName: 'reported_start', correctedValue: null, reason: 'not my record' })).status).toBe(404);
    expect((await request(app).post(`/api/v1/corrections/${req0.body.id}/decide`).set(bearer(pc)).send({ decision: 'APPROVE', note: 'self' })).status).toBe(403);
    await request(app).post(`/api/v1/corrections/${req0.body.id}/decide`).set(bearer(si)).send({ decision: 'APPROVE', note: 'Verified with the HC' }).expect(200);
    const row = (await ctx.pool.query('SELECT status, original_value, corrected_value FROM record_corrections WHERE id = $1', [req0.body.id])).rows[0];
    expect(row.status).toBe('APPROVED');
    expect(row.original_value).toBeNull();
    const session = await ctx.pool.query('SELECT device_started_at FROM duty_sessions WHERE id = $1', [mine.dutySessionId]);
    expect(session.rows[0].device_started_at).toBeNull(); // original untouched
    await expect(ctx.pool.query("UPDATE record_corrections SET corrected_value = '\"x\"' WHERE id = $1", [req0.body.id])).rejects.toThrow(/immutable/);
  });
});

describe('reports, roster, overview, policy and system status', () => {
  it('exports CSV and PDF for every report kind and audits each export', async () => {
    for (const kind of ['assignments', 'roster', 'completion', 'exceptions', 'evidence-verification']) {
      const csv = await request(app).get(`/api/v1/reports/${kind}.csv`).set(bearer(ci));
      expect(csv.status, kind).toBe(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      const pdf = await request(app).get(`/api/v1/reports/${kind}.pdf`).set(bearer(ci)).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
      expect(pdf.status).toBe(200);
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    }
    const audits = await ctx.pool.query("SELECT count(*)::int n FROM audit_events WHERE action = 'REPORT_EXPORTED'");
    expect(audits.rows[0].n).toBeGreaterThanOrEqual(10);
    expect((await request(app).get('/api/v1/reports/assignments.csv').set(bearer(hc))).status).toBe(403);
  });

  it('dashboard figures come from stored records within scope', async () => {
    const dsp = (await rankLogin(app, 'dsp')).token;
    const ops = await request(app).get('/api/v1/dashboard/operations').set(bearer(dsp));
    expect(ops.status).toBe(200);
    const dbCount = await ctx.pool.query(
      "SELECT count(*)::int n FROM duty_assignments WHERE tstzrange(planned_start, planned_end) && tstzrange($1, $2)",
      [ops.body.range.from, ops.body.range.to],
    );
    const apiCount = ops.body.dutiesByCategory.reduce((s: number, c: { total: number }) => s + c.total, 0);
    expect(apiCount).toBe(dbCount.rows[0].n);
    const hcOps = await request(app).get('/api/v1/dashboard/operations').set(bearer(hc));
    const hcCount = hcOps.body.dutiesByCategory.reduce((s: number, c: { total: number }) => s + c.total, 0);
    expect(hcCount).toBeLessThan(apiCount);
    expect(ops.body.personnel.find((p: { cls: string }) => p.cls === 'PC_AR').active).toBe(5);
  });

  it('protects the system status page and reports measured values only', async () => {
    expect((await request(app).get('/api/v1/system/status').set(bearer(si))).status).toBe(403);
    const s = await request(app).get('/api/v1/system/status').set(bearer(admin));
    expect(s.status).toBe(200);
    expect(s.body.database.status).toBe('ok');
    expect(s.body.evidenceStorage.status).toBe('ok');
    expect(s.body.backup.status).toBe('NOT_AVAILABLE');
    expect(s.body.auditChain.ok).toBe(true);
  });

  it('category check-in policy is configurable and reaches the device duty list', async () => {
    await request(app).patch('/api/v1/policy/duty-categories/STATION_WATCH').set(bearer(admin)).send({ checkinMinIntervalMin: 30, checkinMaxIntervalMin: 45, reason: 'test policy' }).expect(200);
    const pcMobile = (await rankLogin(app, 'pc', 'mobile')).token;
    const duties = await request(app).get('/api/v1/duties?pageSize=50').set(bearer(pcMobile));
    const sw = duties.body.items.find((d: { assignment: { category: string } | null }) => d.assignment?.category === 'STATION_WATCH');
    expect(sw.assignment.checkinPolicy).toMatchObject({ minIntervalMin: 30, maxIntervalMin: 45 });
    const tbPolicy = (await request(app).get('/api/v1/policy/duty-categories').set(bearer(pc))).body.items.find((c: { code: string }) => c.code === 'TRAIN_BEAT');
    expect(tbPolicy.checkinMinIntervalMin).not.toBe(30);
    // Drafts are never pushed to devices.
    expect(duties.body.items.every((d: { assignment: { status: string } | null }) => d.assignment?.status !== 'DRAFT')).toBe(true);
  });
});
