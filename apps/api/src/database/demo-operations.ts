/**
 * DEMO DATA — deterministic, fully SYNTHETIC railway-police operational dataset.
 *
 * Names are plausible Telugu-region names chosen for the demonstration; they do not refer to real
 * officers. Personnel IDs, units, train references, VIP labels, incident references and locations
 * are fictional and carry a DEMO prefix. Gender is stored only because it is explicitly supplied
 * here for a balanced sample; it is never used for duty eligibility.
 *
 * Given the same reference date the generator produces the same records (fixed identifiers and
 * relative times), so a demo can be reset and replayed: `pnpm db:seed -- --reset --reference-date 2026-10-15`.
 */
import type pg from 'pg';
import { hashPassword } from '../security/passwords.js';
import { appendAudit } from '../services/audit.js';
import {
  acceptAssignment,
  acknowledgeInstructions,
  addPersonnel,
  createAssignment,
  publishInstructions,
  recordHandover,
  transition,
  type Actor,
  type DutyCategory,
} from '../services/duties.js';

const U = (n: number) => `b0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const P = (n: number) => `21000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = (n: number) => `c0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ACC = (n: number) => `11000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const DEMO_UNITS = {
  subdivision: U(1),
  circleGuntur: U(2),
  circleNarasaraopet: U(3),
  stationGuntur: U(11),
  stationTenali: U(12),
  stationNarasaraopet: U(13),
} as const;

type Cat = 'POLICE' | 'HOME_GUARD';
interface DemoPerson {
  key: string;
  id: string;
  ref: string;
  name: string;
  category: Cat;
  rank: string | null;
  sub: 'AR' | 'GENERAL' | null;
  gender: 'FEMALE' | 'MALE';
  unit: string;
  active?: boolean;
}

/** Synthetic personnel (balanced female/male sample across categories). */
export const DEMO_PERSONNEL: DemoPerson[] = [
  // Home Guards
  { key: 'hg1', id: P(1), ref: 'DEMO-HG-0001', name: 'Bandaru Sravani', category: 'HOME_GUARD', rank: null, sub: null, gender: 'FEMALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'hg2', id: P(2), ref: 'DEMO-HG-0002', name: 'Pothuraju Venkatesh', category: 'HOME_GUARD', rank: null, sub: null, gender: 'MALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'hg3', id: P(3), ref: 'DEMO-HG-0003', name: 'Kakumanu Nagamani', category: 'HOME_GUARD', rank: null, sub: null, gender: 'FEMALE', unit: DEMO_UNITS.stationTenali },
  { key: 'hg4', id: P(4), ref: 'DEMO-HG-0004', name: 'Shaik Mastan Vali', category: 'HOME_GUARD', rank: null, sub: null, gender: 'MALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'hg5', id: P(5), ref: 'DEMO-HG-0005', name: 'Yarlagadda Ramesh', category: 'HOME_GUARD', rank: null, sub: null, gender: 'MALE', unit: DEMO_UNITS.stationNarasaraopet },
  // PC — General
  { key: 'pcg1', id: P(11), ref: 'DEMO-PC-0011', name: 'Chilakalapudi Ravi Teja', category: 'POLICE', rank: 'PC', sub: 'GENERAL', gender: 'MALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'pcg2', id: P(12), ref: 'DEMO-PC-0012', name: 'Gorantla Swathi', category: 'POLICE', rank: 'PC', sub: 'GENERAL', gender: 'FEMALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'pcg3', id: P(13), ref: 'DEMO-PC-0013', name: 'Mekala Durga Prasad', category: 'POLICE', rank: 'PC', sub: 'GENERAL', gender: 'MALE', unit: DEMO_UNITS.stationTenali },
  { key: 'pcg4', id: P(14), ref: 'DEMO-PC-0014', name: 'Nallamothu Bhavani', category: 'POLICE', rank: 'PC', sub: 'GENERAL', gender: 'FEMALE', unit: DEMO_UNITS.stationNarasaraopet },
  { key: 'pcg5', id: P(15), ref: 'DEMO-PC-0015', name: 'Thota Kiran Kumar', category: 'POLICE', rank: 'PC', sub: 'GENERAL', gender: 'MALE', unit: DEMO_UNITS.stationGuntur },
  // PC — Armed Reserve
  { key: 'pca1', id: P(21), ref: 'DEMO-PC-0021', name: 'Vemuri Anil Kumar', category: 'POLICE', rank: 'PC', sub: 'AR', gender: 'MALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'pca2', id: P(22), ref: 'DEMO-PC-0022', name: 'Kotha Sirisha', category: 'POLICE', rank: 'PC', sub: 'AR', gender: 'FEMALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'pca3', id: P(23), ref: 'DEMO-PC-0023', name: 'Gundu Sai Krishna', category: 'POLICE', rank: 'PC', sub: 'AR', gender: 'MALE', unit: DEMO_UNITS.stationTenali },
  { key: 'pca4', id: P(24), ref: 'DEMO-PC-0024', name: 'Pasupuleti Divya', category: 'POLICE', rank: 'PC', sub: 'AR', gender: 'FEMALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'pca5', id: P(25), ref: 'DEMO-PC-0025', name: 'Shaik Abdul Rasheed', category: 'POLICE', rank: 'PC', sub: 'AR', gender: 'MALE', unit: DEMO_UNITS.stationNarasaraopet },
  // Supervisory ranks
  { key: 'hc1', id: P(31), ref: 'DEMO-HC-0031', name: 'Jonnalagadda Srinivasa Rao', category: 'POLICE', rank: 'HC', sub: null, gender: 'MALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'hc2', id: P(32), ref: 'DEMO-HC-0032', name: 'Madala Padmavathi', category: 'POLICE', rank: 'HC', sub: null, gender: 'FEMALE', unit: DEMO_UNITS.stationTenali },
  { key: 'asi1', id: P(41), ref: 'DEMO-ASI-0041', name: 'Kolli Rama Devi', category: 'POLICE', rank: 'ASI', sub: null, gender: 'FEMALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'asi2', id: P(42), ref: 'DEMO-ASI-0042', name: 'Bollineni Satyanarayana', category: 'POLICE', rank: 'ASI', sub: null, gender: 'MALE', unit: DEMO_UNITS.stationNarasaraopet },
  { key: 'si1', id: P(51), ref: 'DEMO-SI-0051', name: 'Ravuri Suresh Babu', category: 'POLICE', rank: 'SI', sub: null, gender: 'MALE', unit: DEMO_UNITS.stationGuntur },
  { key: 'si2', id: P(52), ref: 'DEMO-SI-0052', name: 'Atluri Hymavathi', category: 'POLICE', rank: 'SI', sub: null, gender: 'FEMALE', unit: DEMO_UNITS.stationTenali },
  { key: 'ci1', id: P(61), ref: 'DEMO-CI-0061', name: 'Desu Anuradha', category: 'POLICE', rank: 'CI', sub: null, gender: 'FEMALE', unit: DEMO_UNITS.circleGuntur },
  { key: 'ci2', id: P(62), ref: 'DEMO-CI-0062', name: 'Pinnamaneni Chandrasekhar', category: 'POLICE', rank: 'CI', sub: null, gender: 'MALE', unit: DEMO_UNITS.circleNarasaraopet },
  { key: 'dsp1', id: P(71), ref: 'DEMO-DSP-0071', name: 'Gaddam Venkata Ramana', category: 'POLICE', rank: 'DSP', sub: null, gender: 'MALE', unit: DEMO_UNITS.subdivision },
  // Inactive record (to demonstrate that inactive personnel cannot be newly assigned)
  { key: 'pcx', id: P(81), ref: 'DEMO-PC-0081', name: 'Tummala Prasanna', category: 'POLICE', rank: 'PC', sub: 'GENERAL', gender: 'FEMALE', unit: DEMO_UNITS.stationGuntur, active: false },
];

export const DEMO_PERSON = Object.fromEntries(DEMO_PERSONNEL.map((p) => [p.key, p.id])) as Record<string, string>;

/**
 * Demonstration login accounts requested for the prototype. LOCAL / TEST ENVIRONMENTS ONLY:
 * the passwords follow a published pattern and must never be used for real accounts.
 * Production refuses demo logins unless ALLOW_DEMO_LOGIN=true is set explicitly.
 */
export const DEMO_ACCOUNTS = [
  { key: 'hg', id: ACC(1), email: 'hg@parmaan.demo', password: 'hg-parmaan.demo', role: 'HG', person: 'hg1' },
  { key: 'pc', id: ACC(2), email: 'pc@parmaan.demo', password: 'pc-parmaan.demo', role: 'PC', person: 'pcg1' },
  { key: 'pc.ar', id: ACC(3), email: 'pc.ar@parmaan.demo', password: 'pc.ar-parmaan.demo', role: 'PC', person: 'pca1' },
  { key: 'hc', id: ACC(4), email: 'hc@parmaan.demo', password: 'hc-parmaan.demo', role: 'HC', person: 'hc1' },
  { key: 'asi', id: ACC(5), email: 'asi@parmaan.demo', password: 'asi-parmaan.demo', role: 'ASI', person: 'asi1' },
  { key: 'si', id: ACC(6), email: 'si@parmaan.demo', password: 'si-parmaan.demo', role: 'SI', person: 'si1' },
  { key: 'ci', id: ACC(7), email: 'ci@parmaan.demo', password: 'ci-parmaan.demo', role: 'CI', person: 'ci1' },
  { key: 'dsp', id: ACC(8), email: 'dsp@parmaan.demo', password: 'dsp-parmaan.demo', role: 'DSP', person: 'dsp1' },
  // Additional (not a police rank): prototype system administrator for policy, accounts and devices.
  { key: 'admin', id: ACC(9), email: 'admin@parmaan.demo', password: 'admin-parmaan.demo', role: 'ADMIN', person: null },
] as const;

export const DEMO_ASSIGNMENTS = {
  tbYesterday: A(1),
  tbToday: A(2),
  tbTomorrowTenali: A(3),
  swTodayMorning: A(4),
  swTodayEvening: A(5),
  swTomorrowTenaliDraft: A(6),
  vipTomorrow: A(7),
  tiToday: A(8),
  tiNarasaraopetDraft: A(9),
  swNarasaraopetTomorrow: A(10),
  tbCancelled: A(11),
} as const;

/** 00:00 Asia/Kolkata (UTC+05:30) of the reference date, as a UTC instant. */
export function istMidnight(ref: Date): Date {
  const shifted = new Date(ref.getTime() + 330 * 60_000);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - 330 * 60_000);
}

export async function seedOperationalDemo(
  c: pg.PoolClient,
  referenceDate: Date,
  legacyOfficerIds: string[],
): Promise<{ accounts: number; personnel: number; assignments: number }> {
  const day0 = istMidnight(referenceDate);
  const at = (day: number, hh: number, mm = 0) => new Date(day0.getTime() + day * 86_400_000 + (hh * 60 + mm) * 60_000);

  // Units (fictional names, DEMO codes). Only the Guntur station is linked to an illustrative zone.
  const units: [string, string, string, string, string | null, string | null][] = [
    [DEMO_UNITS.subdivision, 'DEMO-SDV-GNT', 'DEMO Railway Sub-Division (fictional unit)', 'SUBDIVISION', null, null],
    [DEMO_UNITS.circleGuntur, 'DEMO-CIR-GNT', 'DEMO Guntur Circle (fictional unit)', 'CIRCLE', DEMO_UNITS.subdivision, null],
    [DEMO_UNITS.circleNarasaraopet, 'DEMO-CIR-NRT', 'DEMO Narasaraopet Circle (fictional unit)', 'CIRCLE', DEMO_UNITS.subdivision, null],
    [DEMO_UNITS.stationGuntur, 'DEMO-ST-GNT', 'DEMO Guntur station unit (illustrative)', 'STATION', DEMO_UNITS.circleGuntur, 'a0000000-0000-4000-8000-000000000002'],
    [DEMO_UNITS.stationTenali, 'DEMO-ST-TEL', 'DEMO Tenali station unit (illustrative)', 'STATION', DEMO_UNITS.circleGuntur, null],
    [DEMO_UNITS.stationNarasaraopet, 'DEMO-ST-NRT', 'DEMO Narasaraopet station unit (illustrative)', 'STATION', DEMO_UNITS.circleNarasaraopet, null],
  ];
  for (const [id, code, name, type, parent, zone] of units)
    await c.query(
      `INSERT INTO units (id, code, name, unit_type, parent_id, geo_zone_id, is_demo) VALUES ($1,$2,$3,$4,$5,$6,true) ON CONFLICT (id) DO NOTHING`,
      [id, code, name, type, parent, zone],
    );
  await c.query('UPDATE officers SET unit_id = $2 WHERE id = ANY($1::uuid[]) AND unit_id IS NULL', [legacyOfficerIds, DEMO_UNITS.stationGuntur]);

  for (const p of DEMO_PERSONNEL) {
    const station = units.find((u) => u[0] === p.unit)![2].slice(0, 80);
    await c.query(
      `INSERT INTO officers (id, employee_ref, display_name, rank, station, personnel_category, constable_category, gender, unit_id, is_active, is_demo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) ON CONFLICT (id) DO NOTHING`,
      [p.id, p.ref, p.name, p.rank, station, p.category, p.sub, p.gender, p.unit, p.active ?? true],
    );
  }

  for (const a of DEMO_ACCOUNTS) {
    const person = a.person ? DEMO_PERSONNEL.find((p) => p.key === a.person)! : null;
    const hash = await hashPassword(a.password);
    await c.query(
      `INSERT INTO app_users (id, email, display_name, role, password_hash, officer_id, is_demo) VALUES ($1,$2,$3,$4,$5,$6,true)
       ON CONFLICT (id) DO UPDATE SET password_hash = EXCLUDED.password_hash, failed_login_count = 0, locked_until = NULL, is_active = true`,
      [a.id, a.email, person ? person.name : 'DEMO System Administrator', a.role, hash, person?.id ?? null],
    );
  }

  const existing = await c.query('SELECT 1 FROM duty_assignments WHERE id = $1', [DEMO_ASSIGNMENTS.tbYesterday]);
  if (existing.rowCount) return { accounts: DEMO_ACCOUNTS.length, personnel: DEMO_PERSONNEL.length, assignments: 0 };

  const si: Actor & { id: string } = { id: DEMO_ACCOUNTS[5].id, role: 'SI' };
  const ci: Actor & { id: string } = { id: DEMO_ACCOUNTS[6].id, role: 'CI' };
  const p = DEMO_PERSON;
  const people = (ids: [string, 'LEAD' | 'MEMBER'][]) => ids;

  const make = async (
    actor: Actor & { id: string },
    id: string,
    category: DutyCategory,
    title: string,
    unit: string,
    start: Date,
    end: Date,
    extra: Partial<Parameters<typeof createAssignment>[2]>,
    team: [string, 'LEAD' | 'MEMBER'][],
    publish: boolean,
  ) => {
    await createAssignment(c, actor, { id, category, title, unitId: unit, plannedStart: start, plannedEnd: end, isDemo: true, ...extra });
    for (const [officerId, roleInDuty] of team)
      await addPersonnel(c, null, actor, id, { officerId, roleInDuty, canOverride: false });
    if (publish) await transition(c, null, actor, id, { to: 'ASSIGNED' });
  };

  const S = DEMO_UNITS;
  // A. Train beats — flexible staffing: HG + General, two AR, mixed.
  await make(si, DEMO_ASSIGNMENTS.tbYesterday, 'TRAIN_BEAT', 'DEMO train beat — synthetic service DEMO-TRN-101', S.stationGuntur, at(-1, 6), at(-1, 14),
    { trainRef: 'DEMO-TRN-101 (synthetic)', reportingLocation: 'DEMO Platform 1 reporting point (synthetic)' },
    people([[p.hg2!, 'MEMBER'], [p.pcg5!, 'LEAD']]), true);
  await transition(c, null, si, DEMO_ASSIGNMENTS.tbYesterday, { to: 'IN_PROGRESS', reason: 'Marked in progress by a supervisor (not proof of attendance).' });
  await transition(c, null, si, DEMO_ASSIGNMENTS.tbYesterday, { to: 'COMPLETED', completionNote: 'DEMO: beat closed by SI after the synthetic service reached its terminus.' });

  await make(si, DEMO_ASSIGNMENTS.tbToday, 'TRAIN_BEAT', 'DEMO train beat — synthetic service DEMO-TRN-205', S.stationGuntur, at(0, 8), at(0, 16),
    { trainRef: 'DEMO-TRN-205 (synthetic)', reportingLocation: 'DEMO Platform 2 reporting point (synthetic)' },
    people([[p.pca1!, 'LEAD'], [p.pca2!, 'MEMBER']]), true);
  const i1 = await publishInstructions(c, null, si, DEMO_ASSIGNMENTS.tbToday, 'DEMO: Report to the platform reporting point 15 minutes before departure. Keep the duty app open; respond to check-ins.');
  await acknowledgeInstructions(c, { id: DEMO_ACCOUNTS[2].id, role: 'PC' }, p.pca1!, i1.id);
  await publishInstructions(c, null, si, DEMO_ASSIGNMENTS.tbToday, 'DEMO v2: Reporting point changed to the synthetic Platform 3 marker. Acknowledge this version.');

  await make(ci, DEMO_ASSIGNMENTS.tbTomorrowTenali, 'TRAIN_BEAT', 'DEMO train beat — synthetic service DEMO-TRN-318', S.stationTenali, at(1, 10), at(1, 18),
    { trainRef: 'DEMO-TRN-318 (synthetic)' },
    people([[p.pca3!, 'LEAD'], [p.pcg3!, 'MEMBER'], [p.hg3!, 'MEMBER']]), true);

  // B. Station watches — two shifts with a handover, a draft and another circle.
  await make(si, DEMO_ASSIGNMENTS.swTodayMorning, 'STATION_WATCH', 'DEMO station watch — morning shift', S.stationGuntur, at(0, 6), at(0, 14),
    { stationUnitId: S.stationGuntur, reportingLocation: 'DEMO concourse desk (synthetic)', supervisorOfficerId: p.hc1 },
    people([[p.hc1!, 'LEAD'], [p.hg1!, 'MEMBER'], [p.pcg1!, 'MEMBER']]), true);
  await publishInstructions(c, null, si, DEMO_ASSIGNMENTS.swTodayMorning, 'DEMO: Watch the concourse and platform 1 entrances; record any incident through the duty app.');
  await make(si, DEMO_ASSIGNMENTS.swTodayEvening, 'STATION_WATCH', 'DEMO station watch — evening shift', S.stationGuntur, at(0, 14), at(0, 22),
    { stationUnitId: S.stationGuntur, reportingLocation: 'DEMO concourse desk (synthetic)' },
    people([[p.pcg2!, 'LEAD'], [p.hg4!, 'MEMBER']]), true);
  await recordHandover(c, null, si, DEMO_ASSIGNMENTS.swTodayMorning, {
    outgoingOfficerId: p.pcg1!,
    incomingOfficerId: p.pcg2!,
    handoverAt: at(0, 14),
    outstandingTasks: 'DEMO: Lost-property register entry pending verification (synthetic).',
  });
  await make(ci, DEMO_ASSIGNMENTS.swTomorrowTenaliDraft, 'STATION_WATCH', 'DEMO station watch — Tenali (draft)', S.stationTenali, at(1, 6), at(1, 14),
    { stationUnitId: S.stationTenali }, people([[p.hc2!, 'LEAD']]), false);
  await make(ci, DEMO_ASSIGNMENTS.swNarasaraopetTomorrow, 'STATION_WATCH', 'DEMO station watch — Narasaraopet', S.stationNarasaraopet, at(1, 8), at(1, 16),
    { stationUnitId: S.stationNarasaraopet }, people([[p.pcg4!, 'MEMBER'], [p.pca5!, 'MEMBER']]), true);

  // C. VIP escort — restricted; synthetic label only; acceptance required by category policy.
  await make(si, DEMO_ASSIGNMENTS.vipTomorrow, 'VIP_ESCORT', 'DEMO escort for synthetic label DEMO-VIP-A', S.circleGuntur, at(1, 9), at(1, 15),
    { escortLabel: 'DEMO-VIP-A (synthetic label)', reportingLocation: 'DEMO reporting point R-1 (synthetic)', supervisorOfficerId: p.si1 },
    people([[p.si1!, 'LEAD'], [p.pca4!, 'MEMBER'], [p.pca1!, 'MEMBER']]), true);
  await publishInstructions(c, null, si, DEMO_ASSIGNMENTS.vipTomorrow, 'DEMO: Restricted synthetic instructions for the escort exercise. Do not share outside the duty team.');
  await acceptAssignment(c, null, { id: DEMO_ACCOUNTS[5].id, role: 'SI' }, p.si1!, DEMO_ASSIGNMENTS.vipTomorrow);

  // D. Track incidents — restricted; fictional incident references; no victim data.
  await make(si, DEMO_ASSIGNMENTS.tiToday, 'TRACK_INCIDENT', 'DEMO track-incident response (fictional)', S.stationGuntur, at(0, 11), at(0, 19),
    { incidentRef: 'DEMO-INC-0001 (fictional)', reportingLocation: 'DEMO track marker km 0/0 near DEMO yard (synthetic)', supervisorOfficerId: p.asi1 },
    people([[p.asi1!, 'LEAD'], [p.pcg5!, 'MEMBER'], [p.hg2!, 'MEMBER']]), true);
  await publishInstructions(c, null, si, DEMO_ASSIGNMENTS.tiToday, 'DEMO: Secure the synthetic scene marker, record evidence only through the in-app camera, use non-graphic framing.');
  await make(ci, DEMO_ASSIGNMENTS.tiNarasaraopetDraft, 'TRACK_INCIDENT', 'DEMO track-incident response (fictional, draft)', S.stationNarasaraopet, at(2, 9), at(2, 15),
    { incidentRef: 'DEMO-INC-0002 (fictional)' }, people([[p.asi2!, 'LEAD'], [p.hg5!, 'MEMBER']]), false);

  // A cancelled duty (history preserved with the reason).
  await make(si, DEMO_ASSIGNMENTS.tbCancelled, 'TRAIN_BEAT', 'DEMO train beat — synthetic service DEMO-TRN-412', S.stationGuntur, at(3, 7), at(3, 13),
    { trainRef: 'DEMO-TRN-412 (synthetic)' }, people([[p.pcg2!, 'MEMBER']]), true);
  await transition(c, null, si, DEMO_ASSIGNMENTS.tbCancelled, { to: 'CANCELLED', reason: 'DEMO: synthetic service withdrawn from the demo plan.' });

  // Configured unavailability (generic categories; no official leave rules modelled).
  await c.query(
    `INSERT INTO personnel_unavailability (id, officer_id, starts_at, ends_at, category, note, recorded_by, is_demo) VALUES
       ('d0000000-0000-4000-8000-000000000001', $1, $2, $3, 'LEAVE', 'DEMO: synthetic leave entry', $5, true),
       ('d0000000-0000-4000-8000-000000000002', $4, $6, $7, 'TRAINING', 'DEMO: synthetic training day', $5, true)
     ON CONFLICT (id) DO NOTHING`,
    [p.pca2, at(2, 0), at(4, 0), p.pcg2, si.id, at(1, 8), at(1, 17)],
  );

  await appendAudit(c, {
    actorUserId: null,
    actorRole: 'SYSTEM',
    action: 'DEMO_OPERATIONS_SEEDED',
    targetType: 'database',
    details: { synthetic: true, referenceDate: day0.toISOString(), personnel: DEMO_PERSONNEL.length, accounts: DEMO_ACCOUNTS.length },
  });
  return { accounts: DEMO_ACCOUNTS.length, personnel: DEMO_PERSONNEL.length, assignments: Object.keys(DEMO_ASSIGNMENTS).length };
}
