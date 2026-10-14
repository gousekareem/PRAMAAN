/**
 * End-to-end SIMULATED demonstration against a running PRAMAAN API over HTTP.
 *
 * This is a clearly labelled simulator: it produces the same signed, hash-linked events as the
 * Android app, but its location/step/camera values are synthetic. It demonstrates the server
 * side of the workflow (registration, offline queueing, delayed sync, idempotency, tamper
 * detection, evidence verification, export and independent verification). It is NOT evidence
 * of physical Android behaviour.
 *
 * Usage (API running, demo data seeded):
 *   pnpm simulate -- --api http://localhost:4000 --password <SEED_DEMO_PASSWORD> [--out ./out/demo]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { unzipSync, zipSync } from 'fflate';
import { computeEventHash, type SignedEvent } from '@pramaan/event-contracts';
import { verifyPackageZip } from '@pramaan/verifier';
import { SimulatedDevice } from './sim-device.js';

const arg = (name: string, def?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const API = (arg('api', process.env.PRAMAAN_API ?? 'http://localhost:4000') ?? '').replace(
  /\/$/,
  '',
);
const PASSWORD = arg('password', process.env.SEED_DEMO_PASSWORD);
const OUT = resolve(arg('out', './out/demo')!);
if (!PASSWORD) {
  console.error('Provide --password (the SEED_DEMO_PASSWORD used when seeding).');
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const log: { step: number; title: string; outcome: string; details?: unknown }[] = [];
let step = 0;
function record(title: string, outcome: string, details?: unknown) {
  step++;
  log.push({ step, title, outcome, details });
  console.log(`${String(step).padStart(2, '0')}. ${title}\n    → ${outcome}`);
}

async function http(
  method: string,
  path: string,
  opts: { token?: string; json?: unknown; form?: FormData } = {},
) {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
  });
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- demo tool reading loosely-typed JSON
  return { status: res.status, body: body as any, headers: res.headers };
}

const OFFICER1 = '20000000-0000-4000-8000-000000000001';
const DUTY1 = '30000000-0000-4000-8000-000000000001';
const PF1 = { lat: 16.3004, lon: 80.4505 };
const CONC = { lat: 16.2998, lon: 80.4505 };
const YARD = { lat: 16.302, lon: 80.4555 };

async function main() {
  const health = await http('GET', '/ready');
  record('API readiness (/ready)', `HTTP ${health.status} ${JSON.stringify(health.body.checks)}`);

  const officer = await http('POST', '/api/v1/auth/login', {
    json: { email: 'officer1@pramaan.demo', password: PASSWORD, client: 'mobile' },
  });
  if (officer.status !== 200)
    throw new Error(`officer login failed: ${JSON.stringify(officer.body)}`);
  const officerToken = officer.body.accessToken as string;
  record(
    'Officer signs in on the (simulated) duty device',
    `HTTP ${officer.status}; refresh token returned to device only`,
  );
  const admin = await http('POST', '/api/v1/auth/login', {
    json: { email: 'admin@pramaan.demo', password: PASSWORD, client: 'web' },
  });
  const sup = await http('POST', '/api/v1/auth/login', {
    json: { email: 'supervisor@pramaan.demo', password: PASSWORD, client: 'web' },
  });
  const adminToken = admin.body.accessToken as string;
  const supToken = sup.body.accessToken as string;

  const dev = new SimulatedDevice(OFFICER1);
  const reg = await http('POST', '/api/v1/devices/register', {
    token: officerToken,
    json: dev.registration('SIMULATED duty device (synthetic)'),
  });
  record(
    'Register demonstration device public key',
    `HTTP ${reg.status}; status ${reg.body.status}; fingerprint ${String(reg.body.keyFingerprint).slice(0, 16)}…`,
  );
  const early = await http('POST', '/api/v1/sync/batch', {
    token: officerToken,
    json: dev.batch([
      dev.event(
        'DUTY_SESSION_STARTED',
        { assignedZoneIds: [], startedVia: 'APP' },
        { dutySessionId: DUTY1 },
      ),
    ]),
  });
  dev.seq = 0;
  dev.prevHash = '0'.repeat(64);
  record(
    'Sync before administrator approval is refused',
    `HTTP ${early.status} ${early.body.error?.code}`,
  );
  const ap = await http('POST', `/api/v1/devices/${dev.deviceId}/approve`, { token: adminToken });
  record(
    'Administrator approves the device (fingerprint verified out of band)',
    `HTTP ${ap.status} ${ap.body.status}`,
  );

  // ---- Online: start duty + first evidence
  const t0 = Date.now() - 50 * 60_000;
  const at = (min: number) => new Date(t0 + min * 60_000);
  const online: SignedEvent[] = [
    dev.event(
      'DUTY_SESSION_STARTED',
      {
        assignedZoneIds: [
          'a0000000-0000-4000-8000-000000000001',
          'a0000000-0000-4000-8000-000000000002',
        ],
        startedVia: 'APP',
      },
      { dutySessionId: DUTY1, wallTime: at(0) },
    ),
    dev.location(PF1.lat, PF1.lon, 6, { dutySessionId: DUTY1, wallTime: at(1) }),
  ];
  const ev1 = dev.evidence({
    dutySessionId: DUTY1,
    lat: PF1.lat,
    lon: PF1.lon,
    wallTime: at(2),
    steps: 1200,
  });
  online.push(ev1.event);
  const r1 = await http('POST', '/api/v1/sync/batch', {
    token: officerToken,
    json: dev.batch(online),
  });
  record(
    'Start duty session, record location and capture evidence; sync online',
    `HTTP ${r1.status} counts=${JSON.stringify(r1.body.counts)} head=#${r1.body.chainHead?.sequence}`,
  );
  const up1 = await uploadEvidence(officerToken, ev1.evidenceId, ev1.image);
  record(
    'Upload evidence bytes; server recomputes SHA-256',
    `HTTP ${up1.status} ${up1.body.status ?? up1.body.error?.code}`,
  );
  writeFileSync(
    join(OUT, 'local-manifest-example.json'),
    JSON.stringify(
      {
        evidenceId: ev1.evidenceId,
        manifestSha256: (ev1.event.payload as { manifestSha256: string }).manifestSha256,
        manifest: ev1.manifest,
      },
      null,
      2,
    ),
  );
  record(
    'Inspect the local manifest and hash',
    `image SHA-256 ${ev1.manifest.image.sha256.slice(0, 16)}…, written to local-manifest-example.json`,
  );

  // ---- Offline period: events queue locally (not sent)
  const checkinId = randomUUID();
  const sched = at(10);
  const deadline = new Date(sched.getTime() + 3 * 60_000);
  const offline: SignedEvent[] = [
    dev.event(
      'CHECKIN_SCHEDULED',
      {
        checkinId,
        scheduledFor: sched.toISOString(),
        deadlineAt: deadline.toISOString(),
        intervalMs: 6_120_000,
        responseWindowMs: 180_000,
        policyVersion: 1,
      },
      { dutySessionId: DUTY1, wallTime: at(8) },
    ),
    dev.event(
      'CHECKIN_PRESENTED',
      { checkinId, presentedVia: 'FULL_SCREEN_INTENT' },
      { dutySessionId: DUTY1, wallTime: at(10) },
    ),
    dev.event(
      'CHECKIN_MISSED',
      {
        checkinId,
        scheduledFor: sched.toISOString(),
        deadlineAt: deadline.toISOString(),
        detectedAtDevice: at(14).toISOString(),
        reasonCode: 'NO_RESPONSE',
      },
      { dutySessionId: DUTY1, wallTime: at(14) },
    ),
  ];
  offline.push(
    dev.event(
      'BIOMETRIC_SUCCESS',
      {
        checkinId,
        authenticator: 'BIOMETRIC_STRONG',
        keystoreAttestedSignature: null,
        challengeNonce: 'sim-nonce',
      },
      { dutySessionId: DUTY1, wallTime: at(15) },
    ),
  );
  offline.push(
    dev.event(
      'COGNITIVE_CHALLENGE_SUCCESS',
      { checkinId, elapsedMs: 2300, limitMs: 5000, attempts: 1 },
      { dutySessionId: DUTY1, wallTime: at(15) },
    ),
  );
  offline.push(
    dev.event(
      'CHECKIN_ACKNOWLEDGED_LATE',
      {
        checkinId,
        scheduledFor: sched.toISOString(),
        deadlineAt: deadline.toISOString(),
        acknowledgedAtDevice: at(15).toISOString(),
        lateByMs: 120_000,
        missedEventId: offline[2]!.eventId,
      },
      { dutySessionId: DUTY1, wallTime: at(15) },
    ),
  );
  offline.push(
    dev.event(
      'TRANSIT_STATE_SUSPECTED',
      { state: 'ENTERED', speedMps: 19.5, speedAccuracyMps: 1.2, horizontalAccuracyM: 12 },
      { dutySessionId: DUTY1, wallTime: at(20) },
    ),
  );
  offline.push(dev.location(YARD.lat, YARD.lon, 9, { dutySessionId: DUTY1, wallTime: at(30) }));
  offline.push(
    dev.location(CONC.lat, CONC.lon, 5, { dutySessionId: DUTY1, wallTime: at(35), mock: true }),
  );
  const ev2 = dev.evidence({
    dutySessionId: DUTY1,
    lat: CONC.lat,
    lon: CONC.lon,
    wallTime: at(40),
    steps: 1210,
    pattern: 'grid',
  });
  offline.push(ev2.event);
  offline.push(
    dev.event(
      'CLOCK_ANOMALY_DETECTED',
      {
        anomalies: [
          {
            code: 'WALL_CLOCK_ROLLBACK',
            severity: 'WARNING',
            detail: 'Wall clock moved backwards',
            deltaMs: -600000,
          },
        ],
      },
      { dutySessionId: DUTY1, wallTime: at(41) },
    ),
  );
  record(
    'Network disconnected: device records check-in (missed → late), transit, locations, a mock-location fix, evidence and a clock anomaly locally',
    `${offline.length} events queued (seq ${offline[0]!.deviceSequenceNumber}..${offline[offline.length - 1]!.deviceSequenceNumber}); nothing sent`,
  );
  record(
    'App/service restart while offline (simulated)',
    'Queue is held in the persistent outbox; sequence numbers continue (see mobile tests "never resets sequence numbers")',
  );

  // ---- Reconnect: one batch, then the exact same batch again (lost response)
  const batch = dev.batch(offline);
  const r2 = await http('POST', '/api/v1/sync/batch', { token: officerToken, json: batch });
  record(
    'Network restored: queued batch synchronised',
    `HTTP ${r2.status} counts=${JSON.stringify(r2.body.counts)} serverReceivedAt=${r2.body.serverReceivedAt}`,
  );
  const r3 = await http('POST', '/api/v1/sync/batch', { token: officerToken, json: batch });
  record(
    'Duplicate upload of the same batch (e.g. response lost)',
    `HTTP ${r3.status} replayed=${r3.body.replayed}; no duplicate records`,
  );
  const r4 = await http('POST', '/api/v1/sync/batch', {
    token: officerToken,
    json: dev.batch(offline.slice(0, 3)),
  });
  record(
    'Same events re-sent in a new batch',
    `statuses=${r4.body.results.map((x: { status: string }) => x.status).join(',')}`,
  );

  const up2 = await uploadEvidence(officerToken, ev2.evidenceId, ev2.image);
  record('Upload second evidence (periodic pattern)', `HTTP ${up2.status} ${up2.body.status}`);

  // ---- Corrupted payloads
  const tampered = dev.location(PF1.lat, PF1.lon, 5, { dutySessionId: DUTY1, wallTime: at(45) });
  const bad = { ...tampered, payload: { ...tampered.payload, latitude: 16.4 } };
  const r5 = await http('POST', '/api/v1/sync/batch', {
    token: officerToken,
    json: dev.batch([bad]),
  });
  record(
    'Deliberately corrupted event payload (coordinates edited after signing)',
    `${r5.body.results[0].status} ${r5.body.results[0].code}`,
  );
  const forged = { ...bad, eventHash: computeEventHash(bad) };
  const r6 = await http('POST', '/api/v1/sync/batch', {
    token: officerToken,
    json: dev.batch([{ ...forged, deviceSignature: tampered.deviceSignature }]),
  });
  record(
    'Forged client hash (recomputed, but old signature)',
    `${r6.body.results[0].status} ${r6.body.results[0].code}`,
  );
  dev.seq -= 1;
  dev.prevHash = offline[offline.length - 1]!.eventHash;
  const ev3 = dev.evidence({
    dutySessionId: DUTY1,
    lat: PF1.lat,
    lon: PF1.lon,
    wallTime: at(46),
    steps: 1300,
  });
  await http('POST', '/api/v1/sync/batch', { token: officerToken, json: dev.batch([ev3.event]) });
  const corrupt = Buffer.from(ev3.image);
  corrupt[corrupt.length - 40] = corrupt[corrupt.length - 40]! ^ 0xff;
  const up3 = await uploadEvidence(officerToken, ev3.evidenceId, corrupt);
  record(
    'Corrupted evidence bytes uploaded',
    `HTTP ${up3.status} ${up3.body.error?.code} (quarantined, original declaration preserved)`,
  );

  // ---- Supervisor review
  const obs = await http('GET', '/api/v1/dashboard/observations', { token: supToken });
  const mine = obs.body.items.find((x: { officerId: string }) => x.officerId === OFFICER1);
  record(
    'Dashboard observation (last known)',
    `${mine?.freshness.label} ; spatial=${mine?.spatialResult}; accuracy=${mine?.horizontalAccuracyM} m`,
  );
  const alerts = await http('GET', '/api/v1/dashboard/alerts?pageSize=50', { token: supToken });
  const types = [...new Set(alerts.body.items.map((f: { flagType: string }) => f.flagType))].sort();
  record('Review flags raised for supervisor (prompts, not conclusions)', types.join(', '));
  const logs = await http('GET', `/api/v1/patrol-logs?dutySessionId=${DUTY1}&pageSize=100`, {
    token: supToken,
  });
  const spatial = logs.body.items
    .filter((p: { spatialResult: string }) => p.spatialResult !== 'NO_LOCATION')
    .map(
      (p: { eventType: string; spatialResult: string; distanceToAssignedZoneM: number | null }) =>
        `${p.eventType}:${p.spatialResult}${p.distanceToAssignedZoneM ? `(${p.distanceToAssignedZoneM} m)` : ''}`,
    );
  record('PostGIS spatial-zone checks on synchronised observations', spatial.join(' | '));

  // ---- Export + independent verification
  const pkg = await http('GET', `/api/v1/evidence/${ev1.evidenceId}/package`, { token: supToken });
  const zipPath = join(OUT, `sample-evidence-package-${ev1.evidenceId}.zip`);
  writeFileSync(zipPath, pkg.body as Buffer);
  const report = verifyPackageZip(new Uint8Array(pkg.body as Buffer));
  writeFileSync(join(OUT, 'verification-report-original.json'), JSON.stringify(report, null, 2));
  record(
    'Export evidence package and verify it independently (no API/dashboard involved)',
    `${report.status}; ${report.checks.length} checks; package SHA-256 ${pkg.headers.get('x-package-sha256')?.slice(0, 16)}…`,
  );
  const files = unzipSync(new Uint8Array(pkg.body as Buffer));
  const img = files['evidence/original.jpg']!;
  img[500] = img[500]! ^ 0x01;
  const tamperedZip = zipSync(files);
  writeFileSync(join(OUT, 'sample-evidence-package-TAMPERED.zip'), tamperedZip);
  const tReport = verifyPackageZip(tamperedZip);
  writeFileSync(join(OUT, 'verification-report-tampered.json'), JSON.stringify(tReport, null, 2));
  record(
    'Modify ONE bit of the image in a copy of the package and verify again',
    `${tReport.status}: ${tReport.checks
      .filter((c) => c.status === 'FAIL')
      .map((c) => c.id)
      .join(', ')}`,
  );
  const pdf = await http('GET', `/api/v1/evidence/${ev1.evidenceId}/report.pdf`, {
    token: supToken,
  });
  writeFileSync(join(OUT, 'sample-evidence-report.pdf'), pdf.body as Buffer);
  record(
    'Generate evidence report PDF',
    `HTTP ${pdf.status}, ${(pdf.body as Buffer).length} bytes`,
  );
  const audit = await http('GET', '/api/v1/audit-events/verify', { token: adminToken });
  record(
    'Verify the server audit (chain-of-custody) hash chain',
    `ok=${audit.body.ok}; ${audit.body.checked} records; head #${audit.body.headSequence}`,
  );

  writeFileSync(
    join(OUT, 'demo-run.json'),
    JSON.stringify(
      {
        api: API,
        ranAt: new Date().toISOString(),
        simulated: true,
        deviceId: dev.deviceId,
        steps: log,
      },
      null,
      2,
    ),
  );
  console.log(`\nDemo artefacts written to ${OUT}`);
}

async function uploadEvidence(token: string, evidenceId: string, bytes: Buffer) {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(bytes)], { type: 'image/jpeg' }),
    `${evidenceId}.jpg`,
  );
  return http('PUT', `/api/v1/sync/evidence/${evidenceId}`, { token, form });
}

main().catch((e) => {
  console.error('Simulation failed:', e);
  process.exit(1);
});
