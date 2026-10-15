import type pg from 'pg';
import type { EventBus } from '../events/bus.js';
import { withTransaction } from '../database/pool.js';
import { raiseFlag } from './flags.js';
import { notifyAssignmentSupervisors } from './duties.js';

export interface EvaluationResult {
  evaluatedAt: string;
  reportingDelayed: number;
  overdue: number;
  syncFailures: number;
}

/** Device silence during an active duty after which a SYNC_FAILURE exception is raised (minutes). */
export const SYNC_SILENCE_MINUTES = 60;

/**
 * Server-side evaluation of operational exceptions (idempotent through flag dedupe keys):
 *  - DUTY_REPORTING_DELAYED: no device-reported duty start within the category's reporting window
 *    plus grace, or a device-reported start later than that window;
 *  - DUTY_OVERDUE: an open duty past its planned end plus grace;
 *  - SYNC_FAILURE: an active per-person duty whose device has not synchronised for 60 minutes.
 * Exceptions are prompts for supervisory review; they are never classified as misconduct.
 * Device-reported times are untrusted inputs and are labelled as such.
 */
export async function evaluateDutyExceptions(
  pool: pg.Pool,
  bus: EventBus | null,
  now = new Date(),
): Promise<EvaluationResult> {
  return withTransaction(pool, async (c) => {
    let reportingDelayed = 0;
    let overdue = 0;
    let syncFailures = 0;
    const late = await c.query<{
      personnel_id: string;
      assignment_id: string;
      reference_code: string;
      officer_id: string;
      display_name: string;
      planned_start: Date;
      device_started_at: Date | null;
      window_min: number;
      grace_min: number;
    }>(
      `SELECT p.id AS personnel_id, a.id AS assignment_id, a.reference_code, p.officer_id, o.display_name, a.planned_start,
              s.device_started_at, c.reporting_window_min AS window_min, c.grace_min
         FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id
         JOIN duty_categories c ON c.code = a.category JOIN officers o ON o.id = p.officer_id
         LEFT JOIN duty_sessions s ON s.id = p.duty_session_id
        WHERE p.status IN ('ASSIGNED','ACCEPTED') AND a.status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS','EXCEPTION_REPORTED')
          AND a.planned_start + make_interval(mins => c.reporting_window_min + c.grace_min) < $1::timestamptz
          AND (s.device_started_at IS NULL OR s.device_started_at > a.planned_start + make_interval(mins => c.reporting_window_min + c.grace_min))
          AND a.planned_end > a.planned_start`,
      [now],
    );
    for (const r of late.rows) {
      const notStarted = r.device_started_at === null;
      const id = await raiseFlag(c, bus, {
        type: 'DUTY_REPORTING_DELAYED',
        severity: notStarted ? 'MEDIUM' : 'LOW',
        title: notStarted ? 'No duty start reported within the reporting window' : 'Duty start reported after the reporting window',
        description: notStarted
          ? `${r.display_name} has not reported the start of ${r.reference_code} within ${r.window_min} + ${r.grace_min} minutes of the planned start. The device may be offline; review before drawing conclusions.`
          : `${r.display_name}'s device reported starting ${r.reference_code} at ${r.device_started_at!.toISOString()} (device-reported time), after the configured window.`,
        dedupeKey: `report-delay:${r.personnel_id}`,
        officerId: r.officer_id,
        dutyAssignmentId: r.assignment_id,
        inputs: {
          plannedStart: r.planned_start.toISOString(),
          deviceReportedStart: r.device_started_at?.toISOString() ?? null,
          reportingWindowMin: r.window_min,
          graceMin: r.grace_min,
          evaluatedAt: now.toISOString(),
        },
      });
      if (id) {
        reportingDelayed++;
        await notifyAssignmentSupervisors(c, bus, r.assignment_id, `Reporting delayed: ${r.reference_code}`, `${r.display_name}: no timely duty start reported.`, `exc:${id}`);
      }
    }
    const od = await c.query<{ id: string; reference_code: string; planned_end: Date; grace_min: number; status: string; officer_id: string | null }>(
      `SELECT a.id, a.reference_code, a.planned_end, c.grace_min, a.status,
              (SELECT p.officer_id FROM duty_assignment_personnel p WHERE p.assignment_id = a.id ORDER BY p.role_in_duty, p.assigned_at LIMIT 1) AS officer_id
         FROM duty_assignments a JOIN duty_categories c ON c.code = a.category
        WHERE a.status IN ('ASSIGNED','ACCEPTED','IN_PROGRESS','EXCEPTION_REPORTED')
          AND a.planned_end + make_interval(mins => c.grace_min) < $1::timestamptz`,
      [now],
    );
    for (const r of od.rows) {
      const id = await raiseFlag(c, bus, {
        type: 'DUTY_OVERDUE',
        severity: 'LOW',
        title: 'Duty past its planned end and not closed',
        description: `${r.reference_code} (${r.status}) passed its planned end ${r.planned_end.toISOString()} plus ${r.grace_min} minutes grace without being completed or cancelled.`,
        dedupeKey: `overdue:${r.id}`,
        officerId: r.officer_id,
        dutyAssignmentId: r.id,
        inputs: { plannedEnd: r.planned_end.toISOString(), graceMin: r.grace_min, status: r.status, evaluatedAt: now.toISOString() },
      });
      if (id) {
        overdue++;
        await notifyAssignmentSupervisors(c, bus, r.id, `Duty overdue: ${r.reference_code}`, 'The duty has not been closed after its planned end.', `exc:${id}`);
      }
    }
    const silent = await c.query<{ session_id: string; officer_id: string; display_name: string; assignment_id: string; reference_code: string; last_seen: Date | null }>(
      `SELECT s.id AS session_id, s.officer_id, o.display_name, p.assignment_id, a.reference_code,
              (SELECT max(d.last_seen_at) FROM devices d WHERE d.officer_id = s.officer_id) AS last_seen
         FROM duty_sessions s JOIN duty_assignment_personnel p ON p.duty_session_id = s.id
         JOIN duty_assignments a ON a.id = p.assignment_id JOIN officers o ON o.id = s.officer_id
        WHERE s.status = 'ACTIVE' AND a.status IN ('IN_PROGRESS','EXCEPTION_REPORTED') AND s.planned_end > $1::timestamptz - interval '1 hour'`,
      [now],
    );
    for (const r of silent.rows) {
      if (r.last_seen && now.getTime() - r.last_seen.getTime() < SYNC_SILENCE_MINUTES * 60_000) continue;
      const id = await raiseFlag(c, bus, {
        type: 'SYNC_FAILURE',
        severity: 'LOW',
        title: 'No synchronisation from the duty device',
        description: `No batch received from ${r.display_name}'s device for ${SYNC_SILENCE_MINUTES}+ minutes during ${r.reference_code}. Events may be queued offline on the device.`,
        dedupeKey: `syncfail:${r.session_id}`,
        officerId: r.officer_id,
        dutySessionId: r.session_id,
        dutyAssignmentId: r.assignment_id,
        inputs: { lastSyncAt: r.last_seen?.toISOString() ?? null, evaluatedAt: now.toISOString() },
      });
      if (id) syncFailures++;
    }
    return { evaluatedAt: now.toISOString(), reportingDelayed, overdue, syncFailures };
  });
}
