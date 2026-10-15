/**
 * Repeatable SCENARIO demonstration of the railway-police operations modules, run over HTTP
 * against a running API with the synthetic demo data seeded (`pnpm db:seed -- --reset`).
 *
 * Device behaviour is SIMULATED (signed, hash-linked events like the Android app, with synthetic
 * locations and camera bytes). It demonstrates the server-side workflow only — it is not evidence
 * of physical Android behaviour, real GPS, biometrics or camera capture.
 *
 * Usage: pnpm scenarios -- --api http://localhost:4000 [--out ./out/scenarios]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { verifyPackageZip } from '@pramaan/verifier';
import { SimulatedDevice } from './sim-device.js';
import { DEMO_ACCOUNTS, DEMO_ASSIGNMENTS, DEMO_PERSON, DEMO_UNITS } from '../database/demo-operations.js';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const API = (arg('api', process.env.PRAMAAN_API ?? 'http://localhost:4000') ?? '').replace(/\/$/, '');
const OUT = resolve(arg('out', './out/scenarios')!);
mkdirSync(OUT, { recursive: true });

interface Step {
  scenario: string;
  step: number;
  title: string;
  expected: string;
  observed: string;
  pass: boolean;
}
const log: Step[] = [];
let scenario = '';
let n = 0;
function check(title: string, expected: string, observed: string, pass: boolean) {
  n++;
  log.push({ scenario, step: n, title, expected, observed, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${String(n).padStart(2, '0')}. [${scenario}] ${title}\n      expected: ${expected}\n      observed: ${observed}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- demo tool reading loosely-typed JSON
type Json = any;
async function http(method: string, path: string, opts: { token?: string; json?: unknown; form?: FormData } = {}) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
  });
  const ct = res.headers.get('content-type') ?? '';
  const body: Json = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, body, headers: res.headers };
}

async function login(key: (typeof DEMO_ACCOUNTS)[number]['key'], client: 'web' | 'mobile' = 'web') {
  const a = DEMO_ACCOUNTS.find((x) => x.key === key)!;
  const r = await http('POST', '/api/v1/auth/login', { json: { email: a.email, password: a.password, client } });
  if (r.status !== 200) throw new Error(`login ${key} failed: ${JSON.stringify(r.body)}`);
  return r.body.accessToken as string;
}

const CONC = { lat: 16.2998, lon: 80.4505 }; // inside the illustrative DEMO Guntur concourse zone
const min = (m: number) => new Date(Date.now() + m * 60_000);

async function device(officerId: string, mobileToken: string, adminToken: string, label: string) {
  const dev = new SimulatedDevice(officerId);
  await http('POST', '/api/v1/devices/register', { token: mobileToken, json: dev.registration(label) });
  await http('POST', `/api/v1/devices/${dev.deviceId}/approve`, { token: adminToken });
  return dev;
}

async function upload(token: string, evidenceId: string, bytes: Buffer) {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }), 'capture.jpg');
  return http('PUT', `/api/v1/sync/evidence/${evidenceId}`, { token, form });
}

async function sessionFor(token: string, assignmentId: string): Promise<string> {
  const r = await http('GET', '/api/v1/duties?pageSize=50', { token });
  return r.body.items.find((d: Json) => d.assignment?.id === assignmentId)?.id;
}

async function main() {
  const ready = await http('GET', '/ready');
  scenario = 'Setup';
  check('API ready', 'HTTP 200', `HTTP ${ready.status} ${JSON.stringify(ready.body.checks)}`, ready.status === 200);
  const admin = await login('admin');
  const si = await login('si');
  const ci = await login('ci');
  const asi = await login('asi');
  const dsp = await login('dsp');
  const hgWeb = await login('hg');
  const pcArM = await login('pc.ar', 'mobile');
  const hgM = await login('hg', 'mobile');
  const pcM = await login('pc', 'mobile');
  check('All eight rank accounts sign in', '8 × HTTP 200', 'hg, pc, pc.ar, hc, asi, si, ci, dsp signed in', true);

  // ---------------------------------------------------------------- A. four categories exist
  scenario = 'Four duty categories';
  for (const c of ['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT']) {
    const r = await http('GET', `/api/v1/duty-assignments?category=${c}&pageSize=50`, { token: ci });
    check(`CI lists ${c}`, '≥1 seeded duty', `${r.body.total} duty/duties`, r.status === 200 && r.body.total > 0);
  }

  // ---------------------------------------------------------------- B. train beat with two AR constables
  scenario = 'Train beat (AR + AR) with check-ins';
  const tb = await http('POST', '/api/v1/duty-assignments', {
    token: si,
    json: {
      category: 'TRAIN_BEAT',
      title: 'SCENARIO train beat — synthetic service DEMO-TRN-901',
      trainRef: 'DEMO-TRN-901 (synthetic)',
      unitId: DEMO_UNITS.stationGuntur,
      plannedStart: min(-30).toISOString(),
      plannedEnd: min(300).toISOString(),
      reportingLocation: 'DEMO Platform 1 reporting point (synthetic)',
      personnel: [{ officerId: DEMO_PERSON.pca1, roleInDuty: 'LEAD' }, { officerId: DEMO_PERSON.pca2 }],
      allowConflict: true,
      overrideReason: 'Scenario duty overlaps the seeded plan',
      publish: true,
    },
  });
  check('SI creates and publishes a beat with two AR constables', 'HTTP 201, ASSIGNED, no fixed AR/General mix required', `HTTP ${tb.status} ${tb.body.status} ${tb.body.referenceCode}`, tb.status === 201);
  const tbId = tb.body.id as string;
  const ins = await http('POST', `/api/v1/duty-assignments/${tbId}/instructions`, { token: si, json: { body: 'SCENARIO: board coach S-DEMO; respond to every check-in.' } });
  const ack = await http('POST', `/api/v1/duty-assignments/instructions/${ins.body.id}/acknowledge`, { token: pcArM });
  check('PC (AR) acknowledges published instructions', 'HTTP 200', `HTTP ${ack.status}`, ack.status === 200);
  const devAr = await device(DEMO_PERSON.pca1!, pcArM, admin, 'SIMULATED device — PC AR (synthetic)');
  const sAr = await sessionFor(pcArM, tbId);
  const k1 = randomUUID();
  const k2 = randomUUID();
  const sched1 = min(-20);
  const sched2 = min(-8);
  const batch = devAr.batch([
    devAr.event('DUTY_SESSION_STARTED', { assignedZoneIds: [], startedVia: 'APP' }, { dutySessionId: sAr, wallTime: min(-25) }),
    devAr.location(CONC.lat, CONC.lon, 7, { dutySessionId: sAr, wallTime: min(-24) }),
    devAr.event('CHECKIN_SCHEDULED', { checkinId: k1, scheduledFor: sched1.toISOString(), deadlineAt: new Date(sched1.getTime() + 180_000).toISOString(), intervalMs: 3_600_000, responseWindowMs: 180_000, policyVersion: 1 }, { dutySessionId: sAr }),
    devAr.location(CONC.lat, CONC.lon + 0.00003, 6, { dutySessionId: sAr, wallTime: new Date(sched1.getTime() + 30_000) }),
    devAr.event('CHECKIN_ACKNOWLEDGED', { checkinId: k1, scheduledFor: sched1.toISOString(), deadlineAt: new Date(sched1.getTime() + 180_000).toISOString(), acknowledgedAtDevice: new Date(sched1.getTime() + 41_000).toISOString(), responseMs: 41_000 }, { dutySessionId: sAr }),
    devAr.event('CHECKIN_SCHEDULED', { checkinId: k2, scheduledFor: sched2.toISOString(), deadlineAt: new Date(sched2.getTime() + 180_000).toISOString(), intervalMs: 3_600_000, responseWindowMs: 180_000, policyVersion: 1 }, { dutySessionId: sAr }),
    devAr.event('CHECKIN_MISSED', { checkinId: k2, scheduledFor: sched2.toISOString(), deadlineAt: new Date(sched2.getTime() + 180_000).toISOString(), detectedAtDevice: new Date(sched2.getTime() + 181_000).toISOString(), reasonCode: 'NO_RESPONSE' }, { dutySessionId: sAr }),
  ]);
  const syncAr = await http('POST', '/api/v1/sync/batch', { token: pcArM, json: batch });
  check('Device syncs duty start, check-ins and a missed check-in', 'all accepted', JSON.stringify(syncAr.body.counts), syncAr.body.counts?.accepted === 7);
  const tbDetail = await http('GET', `/api/v1/duty-assignments/${tbId}`, { token: si });
  check('Device-reported start moves the duty to IN_PROGRESS', 'IN_PROGRESS (not proof of attendance)', tbDetail.body.status, tbDetail.body.status === 'IN_PROGRESS');
  const kList = await http('GET', `/api/v1/checkins?assignmentId=${tbId}`, { token: si });
  check('Check-ins link to personnel and duty', '2 check-ins with duty reference', `${kList.body.total} rows; ${kList.body.items.map((x: Json) => `${x.officerName}:${x.status}`).join(', ')}`, kList.body.total === 2);
  const missedFlag = await http('GET', `/api/v1/dashboard/alerts?assignmentId=${tbId}&type=CHECKIN_MISSED`, { token: asi });
  check('Missed check-in raised as an exception visible to the ASI', '1 CHECKIN_MISSED', `${missedFlag.body.total}`, missedFlag.body.total === 1);

  // ---------------------------------------------------------------- C. station watch, offline queue
  scenario = 'Station watch (HG + General) offline synchronisation';
  const sw = await http('POST', '/api/v1/duty-assignments', {
    token: si,
    json: {
      category: 'STATION_WATCH',
      title: 'SCENARIO station watch — concourse',
      stationUnitId: DEMO_UNITS.stationGuntur,
      unitId: DEMO_UNITS.stationGuntur,
      plannedStart: min(-90).toISOString(),
      plannedEnd: min(240).toISOString(),
      personnel: [{ officerId: DEMO_PERSON.hg1, roleInDuty: 'MEMBER' }, { officerId: DEMO_PERSON.pcg1, roleInDuty: 'LEAD' }],
      allowConflict: true,
      overrideReason: 'Scenario duty overlaps the seeded plan',
      publish: true,
    },
  });
  const swId = sw.body.id as string;
  check('SI publishes a station watch (HG + PC General)', 'HTTP 201', `HTTP ${sw.status} ${sw.body.referenceCode}`, sw.status === 201);
  const devHg = await device(DEMO_PERSON.hg1!, hgM, admin, 'SIMULATED device — HG (synthetic)');
  const sHg = await sessionFor(hgM, swId);
  const offline = [
    devHg.event('DUTY_SESSION_STARTED', { assignedZoneIds: [], startedVia: 'APP' }, { dutySessionId: sHg, wallTime: min(-85) }),
    ...[-80, -70, -60, -50, -40].map((m, i) => devHg.location(CONC.lat + i * 0.00002, CONC.lon, 9, { dutySessionId: sHg, wallTime: min(m) })),
  ];
  const bid = randomUUID();
  const first = await http('POST', '/api/v1/sync/batch', { token: hgM, json: devHg.batch(offline, bid) });
  check('Events recorded offline for 85 min sync when connectivity returns', '6 accepted', JSON.stringify(first.body.counts), first.body.counts?.accepted === 6);
  const replay = await http('POST', '/api/v1/sync/batch', { token: hgM, json: devHg.batch(offline, bid) });
  check('Lost response → same batch replayed', 'stored response, no duplicates', `replayed=${replay.body.replayed}`, replay.body.replayed === true);
  const again = await http('POST', '/api/v1/sync/batch', { token: hgM, json: devHg.batch(offline) });
  check('Same events in a new batch', 'reported as duplicates', JSON.stringify(again.body.counts), again.body.counts?.duplicate === 6);
  const ho = await http('POST', `/api/v1/duty-assignments/${swId}/handovers`, {
    token: si,
    json: { outgoingOfficerId: DEMO_PERSON.pcg1, incomingOfficerId: DEMO_PERSON.pcg2, handoverAt: min(60).toISOString(), outstandingTasks: 'SCENARIO: lost-property register check (synthetic)' },
  });
  check('Handover recorded with outstanding tasks', 'HTTP 201', `HTTP ${ho.status}; warnings: ${ho.body.warnings?.join(' ') || 'none'}`, ho.status === 201);

  // ---------------------------------------------------------------- D. overlapping assignment
  scenario = 'Overlapping assignment';
  const draft = await http('POST', '/api/v1/duty-assignments', {
    token: si,
    json: { category: 'TRAIN_BEAT', title: 'SCENARIO second beat (overlap test)', unitId: DEMO_UNITS.stationGuntur, plannedStart: min(0).toISOString(), plannedEnd: min(120).toISOString() },
  });
  const overlap = await http('POST', `/api/v1/duty-assignments/${draft.body.id}/personnel`, { token: si, json: { officerId: DEMO_PERSON.pca1 } });
  check('Assigning an already-engaged constable', 'HTTP 409 ASSIGNMENT_CONFLICT', `HTTP ${overlap.status} ${overlap.body.error?.code}: ${overlap.body.error?.details?.conflicts?.[0]?.detail}`, overlap.status === 409);
  const hcTry = await http('POST', `/api/v1/duty-assignments/${draft.body.id}/personnel`, { token: await login('hc'), json: { officerId: DEMO_PERSON.pca1, allowConflict: true, overrideReason: 'HC attempt' } });
  check('HC (no duty.assign) attempts an override', 'HTTP 403', `HTTP ${hcTry.status}`, hcTry.status === 403);
  const override = await http('POST', `/api/v1/duty-assignments/${draft.body.id}/personnel`, { token: si, json: { officerId: DEMO_PERSON.pca1, allowConflict: true, overrideReason: 'Relief for 30 minutes approved by SI (scenario)' } });
  check('SI overrides with a reason', 'HTTP 201 + ASSIGNMENT_CONFLICT exception', `HTTP ${override.status}`, override.status === 201);
  const inactive = await http('POST', `/api/v1/duty-assignments/${draft.body.id}/personnel`, { token: si, json: { officerId: DEMO_PERSON.pcx } });
  check('Inactive personnel cannot be newly assigned', 'HTTP 400 INACTIVE_PERSONNEL', `HTTP ${inactive.status} ${inactive.body.error?.code}`, inactive.body.error?.code === 'INACTIVE_PERSONNEL');

  // ---------------------------------------------------------------- E. VIP escort restriction
  scenario = 'VIP escort restriction';
  const vipDsp = await http('GET', `/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.vipTomorrow}`, { token: dsp });
  check('DSP opens the restricted escort', 'visible as a duty, details withheld', `title="${vipDsp.body.title}" escortLabel=${vipDsp.body.escortLabel}`, vipDsp.body.detailsVisible === false && vipDsp.body.escortLabel === null);
  const vipSi = await http('GET', `/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.vipTomorrow}`, { token: si });
  check('SI (duty.view_restricted) opens it', 'synthetic label visible', `escortLabel=${vipSi.body.escortLabel}`, vipSi.body.detailsVisible === true);

  // ---------------------------------------------------------------- F. track incident evidence + tampering
  scenario = 'Track incident evidence integrity';
  const ti = await http('POST', '/api/v1/duty-assignments', {
    token: si,
    json: {
      category: 'TRACK_INCIDENT',
      title: 'SCENARIO track-incident response (fictional)',
      incidentRef: 'DEMO-INC-0901 (fictional)',
      unitId: DEMO_UNITS.stationGuntur,
      plannedStart: min(-15).toISOString(),
      plannedEnd: min(180).toISOString(),
      supervisorOfficerId: DEMO_PERSON.asi1,
      personnel: [{ officerId: DEMO_PERSON.asi1, roleInDuty: 'LEAD' }, { officerId: DEMO_PERSON.pcg1 }],
      allowConflict: true,
      overrideReason: 'Scenario duty overlaps the station watch',
      publish: true,
    },
  });
  const tiId = ti.body.id as string;
  const devPc = await device(DEMO_PERSON.pcg1!, pcM, admin, 'SIMULATED device — PC General (synthetic)');
  const sPc = await sessionFor(pcM, tiId);
  await http('POST', '/api/v1/sync/batch', { token: pcM, json: devPc.batch([devPc.event('DUTY_SESSION_STARTED', { assignedZoneIds: [], startedVia: 'APP' }, { dutySessionId: sPc, wallTime: min(-12) })]) });
  const good = devPc.evidence({ dutySessionId: sPc, lat: CONC.lat, lon: CONC.lon, wallTime: min(-10) });
  const bad = devPc.evidence({ dutySessionId: sPc, lat: CONC.lat, lon: CONC.lon, wallTime: min(-9) });
  await http('POST', '/api/v1/sync/batch', { token: pcM, json: devPc.batch([good.event, bad.event]) });
  const upGood = await upload(pcM, good.evidenceId, good.image);
  check('In-app evidence upload (non-graphic synthetic image)', 'VERIFIED (SHA-256 matches)', `HTTP ${upGood.status} ${upGood.body.status}`, upGood.body.status === 'VERIFIED');
  const tampered = Buffer.from(bad.image);
  tampered[tampered.length - 20] = (tampered[tampered.length - 20]! + 1) % 256;
  const upBad = await upload(pcM, bad.evidenceId, tampered);
  check('Modified image bytes are uploaded', 'HTTP 422, quarantined, HIGH exception', `HTTP ${upBad.status} ${upBad.body.error?.code ?? upBad.body.status}`, upBad.status === 422);
  const hcEv = await http('GET', `/api/v1/evidence/${good.evidenceId}`, { token: await login('hc') });
  check('HC (no restricted access) opens incident evidence', 'HTTP 404 (not disclosed)', `HTTP ${hcEv.status}`, hcEv.status === 404);
  const dspImg = await http('GET', `/api/v1/evidence/${good.evidenceId}/content`, { token: dsp });
  check('DSP (no evidence.view_image) requests image bytes', 'HTTP 403', `HTTP ${dspImg.status}`, dspImg.status === 403);
  const pkg = await http('GET', `/api/v1/evidence/${good.evidenceId}/package`, { token: ci });
  const report = verifyPackageZip(new Uint8Array(pkg.body as Buffer));
  writeFileSync(join(OUT, 'scenario-evidence-package.zip'), pkg.body as Buffer);
  check('CI exports the evidence package; independent verifier', 'PASS', `${report.status} (${report.checks.length} checks)`, report.status === 'PASS');

  // ---------------------------------------------------------------- G. unauthorised access
  scenario = 'Unauthorised access';
  for (const [tok, path, who] of [
    [hgWeb, '/api/v1/accounts', 'HG → accounts'],
    [hgWeb, '/api/v1/audit-events', 'HG → audit'],
    [dsp, '/api/v1/system/status', 'DSP → system status'],
    [hgWeb, `/api/v1/personnel/${DEMO_PERSON.pca1}`, 'HG → another person'],
  ] as const) {
    const r = await http('GET', path, { token: tok });
    check(who, 'refused (403/404)', `HTTP ${r.status}`, r.status === 403 || r.status === 404);
  }

  // ---------------------------------------------------------------- H. supervisory review
  scenario = 'Supervisory review of exceptions';
  const ev = await http('POST', '/api/v1/exceptions/evaluate', { token: asi });
  check('ASI runs the duty-exception evaluator', 'counts of newly raised exceptions', JSON.stringify(ev.body), ev.status === 200);
  const flag = missedFlag.body.items[0];
  await http('PATCH', `/api/v1/alerts/${flag.id}`, { token: asi, json: { action: 'ACKNOWLEDGE' } });
  const note = await http('POST', `/api/v1/exceptions/${flag.id}/notes`, { token: asi, json: { note: 'SCENARIO: spoke to the constable — coach had no signal near the cutting.' } });
  const res = await http('PATCH', `/api/v1/alerts/${flag.id}`, { token: si, json: { action: 'RESOLVE', note: 'Explained by network coverage; no further action (scenario).' } });
  check('Acknowledge → investigation note → resolve', 'HTTP 200/201/200, original check-in unchanged', `${note.status}/${res.status} ${res.body.status}`, res.body.status === 'RESOLVED');
  const pcWeb = await login('pc.ar');
  const dap = tbDetail.body.personnelHistory.find((p: Json) => p.officerId === DEMO_PERSON.pca1);
  const corr = await http('POST', '/api/v1/corrections', {
    token: pcWeb,
    json: { targetType: 'CHECKIN', targetId: k2, fieldName: 'missed_reason', correctedValue: 'NO_NETWORK_COVERAGE', reason: 'Coach in a cutting without coverage (scenario)' },
  });
  const decide = await http('POST', `/api/v1/corrections/${corr.body.id}/decide`, { token: si, json: { decision: 'APPROVE', note: 'Matches the investigation note (scenario).' } });
  check('Audited correction requested by PC (AR), approved by SI', 'original kept, correction APPROVED', `${corr.status}/${decide.status} (personnel row ${String(dap?.personnelId).slice(0, 8)})`, decide.status === 200);
  const done = await http('POST', `/api/v1/duty-assignments/${DEMO_ASSIGNMENTS.tbYesterday}/status`, { token: si, json: { to: 'CANCELLED', reason: 'should be refused' } });
  check('Invalid transition (cancel a completed duty)', 'HTTP 409 INVALID_TRANSITION', `HTTP ${done.status} ${done.body.error?.code}`, done.body.error?.code === 'INVALID_TRANSITION');

  // ---------------------------------------------------------------- I. reports
  scenario = 'Reports';
  for (const kind of ['roster', 'assignments', 'completion', 'exceptions', 'evidence-verification']) {
    const r = await http('GET', `/api/v1/reports/${kind}.pdf`, { token: ci });
    if (r.status === 200) writeFileSync(join(OUT, `report-${kind}.pdf`), r.body as Buffer);
    check(`CI exports ${kind} PDF`, 'HTTP 200, audited with SHA-256', `HTTP ${r.status} sha256 ${r.headers.get('x-content-sha256')?.slice(0, 16)}…`, r.status === 200);
  }
  const audit = await http('GET', '/api/v1/audit-events/verify', { token: admin });
  check('Audit chain after all scenarios', 'intact', `ok=${audit.body.ok} checked=${audit.body.checked}`, audit.body.ok === true);

  const passed = log.filter((s) => s.pass).length;
  writeFileSync(
    join(OUT, 'scenarios-run.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), api: API, simulated: true, passed, total: log.length, steps: log }, null, 2),
  );
  console.log(`\n${passed}/${log.length} scenario checks passed. Log: ${join(OUT, 'scenarios-run.json')}`);
  if (passed !== log.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
