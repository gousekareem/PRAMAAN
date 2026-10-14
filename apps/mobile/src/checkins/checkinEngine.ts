import { all, one, type SqlDatabase } from '../storage/db';
import { secureRandomInt, uuidV4, type DeviceClock, type RandomSource } from '../types/platform';
import type { LedgerService } from '../ledger/ledger';

export interface CheckinPolicy {
  policyVersion: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  responseWindowMs: number;
  challengeLimitMs: number;
  /** Authorised quiet periods (local wall-clock HH:MM, may wrap past midnight). */
  quietPeriods: { start: string; end: string }[];
  /** Consecutive misses after which the device shows a persistent escalation notice. */
  escalationThreshold: number;
}

export const DEFAULT_POLICY: CheckinPolicy = {
  policyVersion: 1,
  minIntervalMs: 90 * 60_000,
  maxIntervalMs: 150 * 60_000,
  responseWindowMs: 3 * 60_000,
  challengeLimitMs: 5_000,
  quietPeriods: [],
  escalationThreshold: 2,
};

export interface AlarmScheduler {
  /** Idempotent: re-scheduling replaces the previous alarm (single request code). */
  schedule(checkinId: string, triggerAtWallMs: number, deadlineWallMs: number): Promise<void>;
  cancel(): Promise<void>;
}

export interface ScheduledCheckin {
  checkinId: string;
  dutySessionId: string;
  scheduledFor: string;
  deadlineAt: string;
  state: string;
}

function minutesOfDay(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

function parseHm(s: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(s);
  if (!m) throw new Error(`invalid HH:MM ${s}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function inQuietPeriod(
  d: Date,
  periods: CheckinPolicy['quietPeriods'],
): { start: string; end: string } | null {
  const t = minutesOfDay(d);
  for (const p of periods) {
    const a = parseHm(p.start);
    const b = parseHm(p.end);
    if (a <= b ? t >= a && t < b : t >= a || t < b) return p;
  }
  return null;
}

/** Moves a candidate time to the end of any quiet period it falls in. */
export function skipQuietPeriods(candidate: Date, periods: CheckinPolicy['quietPeriods']): Date {
  let d = new Date(candidate);
  for (let guard = 0; guard < 4; guard++) {
    const q = inQuietPeriod(d, periods);
    if (!q) return d;
    const end = parseHm(q.end);
    const next = new Date(d);
    next.setHours(Math.floor(end / 60), end % 60, 0, 0);
    if (next <= d) next.setDate(next.getDate() + 1);
    d = next;
  }
  return d;
}

export interface Challenge {
  code: string;
  issuedAtMonotonicMs: number;
}

/** Three-digit attention challenge. Not identity proof: it shows only that someone read and typed a code. */
export function generateChallenge(rnd: RandomSource, monotonicMs: number): Challenge {
  return {
    code: String(secureRandomInt(rnd, 0, 999)).padStart(3, '0'),
    issuedAtMonotonicMs: monotonicMs,
  };
}

export function evaluateChallenge(
  c: Challenge,
  input: string,
  nowMonotonicMs: number,
  limitMs: number,
): { ok: boolean; reason: 'OK' | 'WRONG_CODE' | 'TIMEOUT'; elapsedMs: number } {
  const elapsedMs = Math.max(0, nowMonotonicMs - c.issuedAtMonotonicMs);
  if (elapsedMs > limitMs) return { ok: false, reason: 'TIMEOUT', elapsedMs };
  if (input.trim() !== c.code) return { ok: false, reason: 'WRONG_CODE', elapsedMs };
  return { ok: true, reason: 'OK', elapsedMs };
}

/**
 * Randomised proof-of-life scheduler with persistent state.
 * Interval ~ Uniform[min, max] from a CSPRNG (rejection sampling), so the next check-in
 * cannot be predicted from previous ones. One outstanding check-in per duty is enforced by
 * a unique partial index, so repeated worker runs or reboots cannot create duplicates.
 */
export class CheckinEngine {
  constructor(
    private readonly db: SqlDatabase,
    private readonly ledger: LedgerService,
    private readonly clock: DeviceClock,
    private readonly random: RandomSource,
    private readonly alarms: AlarmScheduler,
    private readonly policy: CheckinPolicy = DEFAULT_POLICY,
  ) {}

  async outstanding(dutySessionId: string): Promise<ScheduledCheckin | undefined> {
    const r = await one(
      this.db,
      "SELECT checkin_id, duty_session_id, scheduled_for, deadline_at, state FROM checkin_schedule WHERE duty_session_id = ? AND state IN ('SCHEDULED','PRESENTED')",
      [dutySessionId],
    );
    return r
      ? {
          checkinId: String(r.checkin_id),
          dutySessionId: String(r.duty_session_id),
          scheduledFor: String(r.scheduled_for),
          deadlineAt: String(r.deadline_at),
          state: String(r.state),
        }
      : undefined;
  }

  /** Schedules the next check-in unless one is outstanding or the duty ends first. */
  async scheduleNext(dutySessionId: string, dutyEndIso: string): Promise<ScheduledCheckin | null> {
    const existing = await this.outstanding(dutySessionId);
    if (existing) {
      await this.alarms.schedule(
        existing.checkinId,
        Date.parse(existing.scheduledFor),
        Date.parse(existing.deadlineAt),
      );
      return existing;
    }
    const now = await this.clock.now();
    const interval = secureRandomInt(
      this.random,
      this.policy.minIntervalMs,
      this.policy.maxIntervalMs,
    );
    const at = skipQuietPeriods(
      new Date(Date.parse(now.wallTime) + interval),
      this.policy.quietPeriods,
    );
    const deadline = new Date(at.getTime() + this.policy.responseWindowMs);
    if (deadline.getTime() > Date.parse(dutyEndIso)) return null;
    const checkinId = uuidV4(this.random);
    const row: ScheduledCheckin = {
      checkinId,
      dutySessionId,
      scheduledFor: at.toISOString(),
      deadlineAt: deadline.toISOString(),
      state: 'SCHEDULED',
    };
    try {
      await this.ledger.append(
        'CHECKIN_SCHEDULED',
        {
          checkinId,
          scheduledFor: row.scheduledFor,
          deadlineAt: row.deadlineAt,
          intervalMs: interval,
          responseWindowMs: this.policy.responseWindowMs,
          policyVersion: this.policy.policyVersion,
        },
        {
          dutySessionId,
          alsoInTx: async (tx) => {
            await tx.execute(
              `INSERT INTO checkin_schedule (checkin_id, duty_session_id, scheduled_for, deadline_at, scheduled_monotonic_ms, boot_id, interval_ms, response_window_ms, state, created_at)
             VALUES (?,?,?,?,?,?,?,?, 'SCHEDULED', ?)`,
              [
                checkinId,
                dutySessionId,
                row.scheduledFor,
                row.deadlineAt,
                now.monotonicMs + (at.getTime() - Date.parse(now.wallTime)),
                now.bootId,
                interval,
                this.policy.responseWindowMs,
                new Date().toISOString(),
              ],
            );
          },
        },
      );
    } catch (e) {
      // Unique index violation = another worker scheduled concurrently; use that one.
      const other = await this.outstanding(dutySessionId);
      if (other) return other;
      throw e;
    }
    await this.alarms.schedule(checkinId, at.getTime(), deadline.getTime());
    return row;
  }

  async markPresented(
    checkinId: string,
    via: 'NOTIFICATION' | 'FULL_SCREEN_INTENT' | 'APP_FOREGROUND',
  ): Promise<void> {
    const r = await one(
      this.db,
      'SELECT duty_session_id, state FROM checkin_schedule WHERE checkin_id = ?',
      [checkinId],
    );
    if (!r || r.state !== 'SCHEDULED') return;
    await this.ledger.append(
      'CHECKIN_PRESENTED',
      { checkinId, presentedVia: via },
      {
        dutySessionId: String(r.duty_session_id),
        alsoInTx: (tx) =>
          tx
            .execute(
              "UPDATE checkin_schedule SET state = 'PRESENTED' WHERE checkin_id = ? AND state = 'SCHEDULED'",
              [checkinId],
            )
            .then(() => undefined),
      },
    );
  }

  /**
   * Restart/clock-change safe deadline evaluation. A check-in is missed when EITHER the
   * monotonic deadline (same boot) or the wall-clock deadline has passed — moving the wall
   * clock backwards cannot extend the response window within a boot.
   */
  async evaluateDeadlines(): Promise<string[]> {
    const now = await this.clock.now();
    const open = await all(
      this.db,
      "SELECT * FROM checkin_schedule WHERE state IN ('SCHEDULED','PRESENTED')",
    );
    const missed: string[] = [];
    for (const c of open) {
      const sameBoot = c.boot_id === now.bootId;
      const monoDeadline = Number(c.scheduled_monotonic_ms) + Number(c.response_window_ms);
      const wallExpired = Date.parse(now.wallTime) > Date.parse(String(c.deadline_at));
      const monoExpired = sameBoot && now.monotonicMs > monoDeadline;
      if (!wallExpired && !monoExpired) continue;
      const id = String(c.checkin_id);
      const reason = !sameBoot
        ? 'DEVICE_REBOOTED'
        : c.state === 'SCHEDULED'
          ? 'APP_NOT_RUNNING'
          : 'NO_RESPONSE';
      await this.ledger.append(
        'CHECKIN_MISSED',
        {
          checkinId: id,
          scheduledFor: String(c.scheduled_for),
          deadlineAt: String(c.deadline_at),
          detectedAtDevice: now.wallTime,
          reasonCode: reason,
        },
        {
          dutySessionId: String(c.duty_session_id),
          alsoInTx: (tx, event) =>
            tx
              .execute(
                "UPDATE checkin_schedule SET state = 'MISSED', missed_event_id = ? WHERE checkin_id = ?",
                [event.eventId, id],
              )
              .then(() => undefined),
        },
      );
      missed.push(id);
    }
    return missed;
  }

  async recordBiometric(
    checkinId: string,
    r:
      | {
          success: true;
          authenticator: 'BIOMETRIC_STRONG' | 'BIOMETRIC_WEAK' | 'DEVICE_CREDENTIAL';
          keystoreAttestedSignature: string | null;
          nonce: string;
        }
      | { success: false; errorCode: string; userCancelled: boolean },
  ): Promise<void> {
    const c = await one(
      this.db,
      'SELECT duty_session_id FROM checkin_schedule WHERE checkin_id = ?',
      [checkinId],
    );
    if (!c) throw new Error('unknown check-in');
    if (r.success) {
      await this.ledger.append(
        'BIOMETRIC_SUCCESS',
        {
          checkinId,
          authenticator: r.authenticator,
          keystoreAttestedSignature: r.keystoreAttestedSignature,
          challengeNonce: r.nonce,
        },
        { dutySessionId: String(c.duty_session_id) },
      );
    } else {
      await this.ledger.append(
        'BIOMETRIC_FAILURE',
        { checkinId, errorCode: r.errorCode, userCancelled: r.userCancelled },
        { dutySessionId: String(c.duty_session_id) },
      );
    }
  }

  /**
   * Records the challenge result and, on success, the acknowledgment. A response after the
   * deadline is recorded as CHECKIN_ACKNOWLEDGED_LATE and never rewrites the missed record.
   */
  async completeChallenge(
    checkinId: string,
    result: ReturnType<typeof evaluateChallenge>,
    attempts: number,
  ): Promise<'ACKNOWLEDGED' | 'ACKNOWLEDGED_LATE' | 'FAILED'> {
    const c = await one(this.db, 'SELECT * FROM checkin_schedule WHERE checkin_id = ?', [
      checkinId,
    ]);
    if (!c) throw new Error('unknown check-in');
    const duty = String(c.duty_session_id);
    const limitMs = this.policy.challengeLimitMs;
    if (!result.ok) {
      await this.ledger.append(
        'COGNITIVE_CHALLENGE_FAILURE',
        {
          checkinId,
          elapsedMs: result.elapsedMs,
          limitMs,
          attempts,
          reason: result.reason === 'TIMEOUT' ? 'TIMEOUT' : 'WRONG_CODE',
        },
        { dutySessionId: duty },
      );
      return 'FAILED';
    }
    await this.ledger.append(
      'COGNITIVE_CHALLENGE_SUCCESS',
      { checkinId, elapsedMs: result.elapsedMs, limitMs, attempts },
      { dutySessionId: duty },
    );
    await this.evaluateDeadlines();
    const now = await this.clock.now();
    const fresh = await one(
      this.db,
      'SELECT state, missed_event_id FROM checkin_schedule WHERE checkin_id = ?',
      [checkinId],
    );
    const base = {
      checkinId,
      scheduledFor: String(c.scheduled_for),
      deadlineAt: String(c.deadline_at),
      acknowledgedAtDevice: now.wallTime,
    };
    if (fresh?.state === 'MISSED') {
      const lateByMs = Math.max(1, Date.parse(now.wallTime) - Date.parse(String(c.deadline_at)));
      await this.ledger.append(
        'CHECKIN_ACKNOWLEDGED_LATE',
        { ...base, lateByMs, missedEventId: (fresh.missed_event_id as string | null) ?? null },
        {
          dutySessionId: duty,
          alsoInTx: (tx) =>
            tx
              .execute(
                "UPDATE checkin_schedule SET state = 'ACKNOWLEDGED_LATE' WHERE checkin_id = ?",
                [checkinId],
              )
              .then(() => undefined),
        },
      );
      return 'ACKNOWLEDGED_LATE';
    }
    if (fresh?.state === 'ACKNOWLEDGED' || fresh?.state === 'ACKNOWLEDGED_LATE')
      return fresh.state as 'ACKNOWLEDGED';
    await this.ledger.append(
      'CHECKIN_ACKNOWLEDGED',
      {
        ...base,
        responseMs: Math.max(0, Date.parse(now.wallTime) - Date.parse(String(c.scheduled_for))),
      },
      {
        dutySessionId: duty,
        alsoInTx: (tx) =>
          tx
            .execute("UPDATE checkin_schedule SET state = 'ACKNOWLEDGED' WHERE checkin_id = ?", [
              checkinId,
            ])
            .then(() => undefined),
      },
    );
    await this.alarms.cancel();
    return 'ACKNOWLEDGED';
  }

  async consecutiveMisses(dutySessionId: string): Promise<number> {
    const rows = await all(
      this.db,
      "SELECT state FROM checkin_schedule WHERE duty_session_id = ? AND state NOT IN ('SCHEDULED','PRESENTED','CANCELLED') ORDER BY scheduled_for DESC LIMIT 10",
      [dutySessionId],
    );
    let n = 0;
    for (const r of rows) {
      if (r.state === 'MISSED') n++;
      else break;
    }
    return n;
  }

  async cancelForDuty(dutySessionId: string): Promise<void> {
    await this.db.execute(
      "UPDATE checkin_schedule SET state = 'CANCELLED' WHERE duty_session_id = ? AND state IN ('SCHEDULED','PRESENTED')",
      [dutySessionId],
    );
    await this.alarms.cancel();
  }
}
