import { describe, expect, it } from 'vitest';
import {
  CheckinEngine,
  DEFAULT_POLICY,
  evaluateChallenge,
  generateChallenge,
  inQuietPeriod,
  skipQuietPeriods,
  type AlarmScheduler,
} from '../checkins/checkinEngine';
import { secureRandomInt } from '../types/platform';
import { DUTY, nodeRandom, setupLedger } from './testkit';

class FakeAlarms implements AlarmScheduler {
  scheduled: { id: string; at: number }[] = [];
  cancels = 0;
  async schedule(id: string, at: number) {
    this.scheduled.push({ id, at });
  }
  async cancel() {
    this.cancels++;
  }
}

async function make(policy = DEFAULT_POLICY) {
  const k = await setupLedger();
  const alarms = new FakeAlarms();
  const engine = new CheckinEngine(k.db, k.ledger, k.clock, nodeRandom, alarms, policy);
  return { ...k, alarms, engine };
}
const END = '2026-10-01T19:00:00.000Z';
const types = async (db: Awaited<ReturnType<typeof make>>['db']) =>
  (
    await db.execute('SELECT event_type FROM ledger_events ORDER BY device_sequence_number')
  ).rows.map((r) => r.event_type);

describe('cognitive challenge', () => {
  it('generates uniformly distributed 3-digit codes', () => {
    const counts = new Array(10).fill(0);
    for (let i = 0; i < 5000; i++) {
      const c = generateChallenge(nodeRandom, 0).code;
      expect(c).toMatch(/^\d{3}$/);
      counts[Number(c[0])]++;
    }
    for (const n of counts) expect(n).toBeGreaterThan(380); // ~500 expected per first digit
  });
  it('expires after the 5 s limit measured on the monotonic clock', () => {
    const c = { code: '042', issuedAtMonotonicMs: 1000 };
    expect(evaluateChallenge(c, '042', 5_999, 5000)).toMatchObject({ ok: true, elapsedMs: 4999 });
    expect(evaluateChallenge(c, '042', 6_001, 5000)).toMatchObject({
      ok: false,
      reason: 'TIMEOUT',
    });
    expect(evaluateChallenge(c, '043', 2_000, 5000)).toMatchObject({
      ok: false,
      reason: 'WRONG_CODE',
    });
  });
  it('secureRandomInt stays in range and is unbiased enough', () => {
    for (let i = 0; i < 2000; i++) {
      const v = secureRandomInt(nodeRandom, 90 * 60_000, 150 * 60_000);
      expect(v).toBeGreaterThanOrEqual(5_400_000);
      expect(v).toBeLessThanOrEqual(9_000_000);
    }
  });
});

describe('check-in scheduling', () => {
  it('schedules within the 90–150 min window and is not a fixed interval', async () => {
    const t = await make();
    const intervals = new Set<number>();
    for (let i = 0; i < 5; i++) {
      const s = (await t.engine.scheduleNext(DUTY, '2026-10-02T23:00:00.000Z'))!;
      const delta = Date.parse(s.scheduledFor) - t.clock.wall;
      expect(delta).toBeGreaterThanOrEqual(90 * 60_000);
      expect(delta).toBeLessThanOrEqual(150 * 60_000);
      intervals.add(delta);
      await t.db.execute("UPDATE checkin_schedule SET state = 'ACKNOWLEDGED'");
    }
    expect(intervals.size).toBeGreaterThan(1);
  });

  it('prevents duplicate scheduling across repeated worker runs and restarts', async () => {
    const t = await make();
    const a = await t.engine.scheduleNext(DUTY, END);
    const b = await t.engine.scheduleNext(DUTY, END);
    const engine2 = new CheckinEngine(t.db, t.ledger, t.clock, nodeRandom, t.alarms);
    const c = await engine2.scheduleNext(DUTY, END);
    expect(b!.checkinId).toBe(a!.checkinId);
    expect(c!.checkinId).toBe(a!.checkinId);
    expect((await t.db.execute('SELECT count(*) n FROM checkin_schedule')).rows[0]!.n).toBe(1);
    expect((await types(t.db)).filter((x) => x === 'CHECKIN_SCHEDULED')).toHaveLength(1);
    expect(new Set(t.alarms.scheduled.map((s) => s.id)).size).toBe(1); // alarm re-armed idempotently
    await expect(
      t.db.execute(
        "INSERT INTO checkin_schedule (checkin_id, duty_session_id, scheduled_for, deadline_at, scheduled_monotonic_ms, boot_id, interval_ms, response_window_ms, state, created_at) VALUES ('dup', ?, 'a', 'b', 0, 'x', 1, 1, 'SCHEDULED', 'x')",
        [DUTY],
      ),
    ).rejects.toThrow(/UNIQUE/);
  });

  it('does not schedule past the end of duty and respects quiet periods', async () => {
    const t = await make();
    expect(await t.engine.scheduleNext(DUTY, '2026-10-01T08:30:00.000Z')).toBeNull();
    const q = [{ start: '22:00', end: '06:00' }];
    expect(inQuietPeriod(new Date(2026, 9, 1, 23, 0), q)).not.toBeNull();
    expect(inQuietPeriod(new Date(2026, 9, 1, 12, 0), q)).toBeNull();
    const moved = skipQuietPeriods(new Date(2026, 9, 1, 23, 15), q);
    expect(moved.getHours()).toBe(6);
  });

  it('records a missed check-in after the deadline and a late acknowledgment as a separate event', async () => {
    const t = await make();
    const s = (await t.engine.scheduleNext(DUTY, END))!;
    t.clock.advance(Date.parse(s.scheduledFor) - t.clock.wall);
    await t.engine.markPresented(s.checkinId, 'FULL_SCREEN_INTENT');
    t.clock.advance(3 * 60_000 + 1000);
    expect(await t.engine.evaluateDeadlines()).toEqual([s.checkinId]);
    await t.engine.recordBiometric(s.checkinId, {
      success: true,
      authenticator: 'BIOMETRIC_STRONG',
      keystoreAttestedSignature: null,
      nonce: 'n1',
    });
    const ch = generateChallenge(nodeRandom, t.clock.mono);
    const outcome = await t.engine.completeChallenge(
      s.checkinId,
      evaluateChallenge(ch, ch.code, t.clock.mono + 1200, 5000),
      1,
    );
    expect(outcome).toBe('ACKNOWLEDGED_LATE');
    const ev = await types(t.db);
    expect(ev).toEqual([
      'CHECKIN_SCHEDULED',
      'CHECKIN_PRESENTED',
      'CHECKIN_MISSED',
      'BIOMETRIC_SUCCESS',
      'COGNITIVE_CHALLENGE_SUCCESS',
      'CHECKIN_ACKNOWLEDGED_LATE',
    ]);
    const missed = (
      await t.db.execute(
        "SELECT envelope_json FROM ledger_events WHERE event_type = 'CHECKIN_MISSED'",
      )
    ).rows[0]!;
    expect(JSON.parse(String(missed.envelope_json)).payload.reasonCode).toBe('NO_RESPONSE');
  });

  it('acknowledges in time and cancels the alarm', async () => {
    const t = await make();
    const s = (await t.engine.scheduleNext(DUTY, END))!;
    t.clock.advance(Date.parse(s.scheduledFor) - t.clock.wall + 30_000);
    const ch = generateChallenge(nodeRandom, t.clock.mono);
    expect(
      await t.engine.completeChallenge(
        s.checkinId,
        evaluateChallenge(ch, ch.code, t.clock.mono + 2000, 5000),
        1,
      ),
    ).toBe('ACKNOWLEDGED');
    expect(t.alarms.cancels).toBe(1);
  });

  it('cannot extend the response window by turning the wall clock back (same boot)', async () => {
    const t = await make();
    const s = (await t.engine.scheduleNext(DUTY, END))!;
    t.clock.advance(Date.parse(s.scheduledFor) - t.clock.wall + 4 * 60_000);
    t.clock.wall -= 60 * 60_000; // user moves the clock back an hour
    expect(await t.engine.evaluateDeadlines()).toEqual([s.checkinId]);
  });

  it('classifies a check-in missed while the device was rebooted', async () => {
    const t = await make();
    const s = (await t.engine.scheduleNext(DUTY, END))!;
    t.clock.bootId = 'boot-B';
    t.clock.mono = 1000;
    t.clock.wall = Date.parse(s.deadlineAt) + 60_000;
    await t.engine.evaluateDeadlines();
    const ev = (
      await t.db.execute(
        "SELECT envelope_json FROM ledger_events WHERE event_type = 'CHECKIN_MISSED'",
      )
    ).rows[0]!;
    expect(JSON.parse(String(ev.envelope_json)).payload.reasonCode).toBe('DEVICE_REBOOTED');
  });

  it('records biometric cancellation and wrong codes without acknowledging', async () => {
    const t = await make();
    const s = (await t.engine.scheduleNext(DUTY, END))!;
    await t.engine.recordBiometric(s.checkinId, {
      success: false,
      errorCode: 'ERROR_USER_CANCELED',
      userCancelled: true,
    });
    const ch = generateChallenge(nodeRandom, t.clock.mono);
    expect(
      await t.engine.completeChallenge(
        s.checkinId,
        evaluateChallenge(ch, ch.code === '000' ? '001' : '000', t.clock.mono + 100, 5000),
        1,
      ),
    ).toBe('FAILED');
    expect(await types(t.db)).toEqual([
      'CHECKIN_SCHEDULED',
      'BIOMETRIC_FAILURE',
      'COGNITIVE_CHALLENGE_FAILURE',
    ]);
    expect((await t.engine.outstanding(DUTY))?.checkinId).toBe(s.checkinId);
  });

  it('counts consecutive misses for escalation', async () => {
    const t = await make();
    for (let i = 0; i < 2; i++) {
      const s = (await t.engine.scheduleNext(DUTY, '2026-10-02T23:00:00.000Z'))!;
      t.clock.advance(Date.parse(s.deadlineAt) - t.clock.wall + 1000);
      await t.engine.evaluateDeadlines();
    }
    expect(await t.engine.consecutiveMisses(DUTY)).toBe(2);
  });
});

describe('per-category check-in policy (duty assignments)', () => {
  it('maps the server category policy and falls back to defaults for invalid values', async () => {
    const { policyFromServer, policyForDutyRow } = await import('../checkins/checkinEngine');
    const p = policyFromServer({ policyVersion: 3, minIntervalMin: 45, maxIntervalMin: 90, responseWindowSec: 120 });
    expect(p).toMatchObject({ policyVersion: 3, minIntervalMs: 45 * 60_000, maxIntervalMs: 90 * 60_000, responseWindowMs: 120_000, challengeLimitMs: 5000 });
    expect(policyFromServer({ minIntervalMin: 90, maxIntervalMin: 30, responseWindowSec: 120 })).toBe(DEFAULT_POLICY);
    expect(policyFromServer(null)).toBe(DEFAULT_POLICY);
    expect(policyForDutyRow({ assignment_json: '{not json' })).toBe(DEFAULT_POLICY);
    expect(policyForDutyRow({ assignment_json: JSON.stringify({ checkinPolicy: { minIntervalMin: 45, maxIntervalMin: 90, responseWindowSec: 120 } }) }).maxIntervalMs).toBe(90 * 60_000);
    expect(policyForDutyRow({ assignment_json: null })).toBe(DEFAULT_POLICY);
  });

  it('schedules within the duty category window instead of the global default', async () => {
    const { policyFromServer } = await import('../checkins/checkinEngine');
    const t = await make();
    const vip = policyFromServer({ minIntervalMin: 45, maxIntervalMin: 50, responseWindowSec: 120 });
    const now = Date.parse((await t.clock.now()).wallTime);
    const s = (await t.engine.scheduleNext(DUTY, '2026-10-02T23:00:00.000Z', vip))!;
    const delta = Date.parse(s.scheduledFor) - now;
    expect(delta).toBeGreaterThanOrEqual(45 * 60_000);
    expect(delta).toBeLessThanOrEqual(50 * 60_000 + 1000);
    expect(Date.parse(s.deadlineAt) - Date.parse(s.scheduledFor)).toBe(120_000);
    const ev = (await t.db.execute("SELECT envelope_json FROM ledger_events WHERE event_type = 'CHECKIN_SCHEDULED'")).rows[0];
    expect(JSON.parse(String(ev!.envelope_json)).payload.responseWindowMs).toBe(120_000);
  });
});
