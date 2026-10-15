import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, can, h, requireAnyPermission, requirePermission, type AuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import {
  assertOfficerInScope,
  assignmentScopeSql,
  officerScopeSql,
  restrictedSessionFilterSql,
} from '../security/access.js';
import { appendAudit } from '../services/audit.js';
import { DUTY_CATEGORIES } from '../services/duties.js';
import { notifyUsers } from '../services/notifications.js';
import { isoQuery, pageQuery, pageResult, paging, param, uuidParam } from './common.js';

const DAY = 86_400_000;

/** Duty roster: personnel in scope × days, with duties, unavailability and conflicts. */
export function rosterRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    requirePermission('roster.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = z
        .object({
          from: isoQuery,
          to: isoQuery,
          unitId: uuidParam.optional(),
          category: z.enum(DUTY_CATEGORIES).optional(),
        })
        .parse(req.query);
      const from = new Date(q.from);
      const to = new Date(q.to);
      if (to <= from || to.getTime() - from.getTime() > 42 * DAY)
        throw new AppError(400, 'VALIDATION_FAILED', 'Roster range must be positive and at most 42 days.');
      const pArgs: unknown[] = [];
      const pWhere = [officerScopeSql(u, 'o.id', pArgs)];
      if (q.unitId) {
        pArgs.push(q.unitId);
        pWhere.push(`o.unit_id = $${pArgs.length}`);
      }
      const people = (
        await ctx.pool.query<{ id: string }>(
          `SELECT o.id, o.employee_ref AS "personnelRef", o.display_name AS "displayName", o.personnel_category AS "personnelCategory",
              o.rank, o.constable_category AS "constableCategory", o.is_active AS "isActive", o.unit_id AS "unitId", un.name AS "unitName"
             FROM officers o LEFT JOIN units un ON un.id = o.unit_id WHERE ${pWhere.join(' AND ')}
            ORDER BY un.name NULLS LAST, CASE WHEN o.personnel_category = 'HOME_GUARD' THEN 0 ELSE 1 END,
                     array_position(ARRAY['PC','HC','ASI','SI','CI','DSP','OTHER'], o.rank), o.display_name LIMIT 500`,
          pArgs,
        )
      ).rows;
      const ids = people.map((p) => p.id);
      const dArgs: unknown[] = [ids, from, to];
      const dWhere = [assignmentScopeSql(u, 'a', dArgs)];
      if (q.category) {
        dArgs.push(q.category);
        dWhere.push(`a.category = $${dArgs.length}`);
      }
      dArgs.push(can(u, 'duty.view_restricted'));
      const canR = `$${dArgs.length}::boolean`;
      dArgs.push(u.officerId);
      const self = `$${dArgs.length}::uuid`;
      const duties = (
        await ctx.pool.query<{ officerId: string; plannedStart: Date; plannedEnd: Date; assignmentId: string; status: string }>(
          `SELECT p.officer_id AS "officerId", a.id AS "assignmentId", a.reference_code AS "referenceCode", a.category, a.status,
              p.status AS "personnelStatus", p.role_in_duty AS "roleInDuty", a.planned_start AS "plannedStart", a.planned_end AS "plannedEnd",
              CASE WHEN NOT c.is_restricted OR ${canR} OR p.officer_id = ${self} THEN a.title ELSE c.label || ' (restricted)' END AS title
             FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id JOIN duty_categories c ON c.code = a.category
            WHERE p.officer_id = ANY($1::uuid[]) AND p.status IN ('ASSIGNED','ACCEPTED') AND a.status <> 'CANCELLED'
              AND tstzrange(a.planned_start, a.planned_end) && tstzrange($2, $3) AND ${dWhere.join(' AND ')}
            ORDER BY a.planned_start`,
          dArgs,
        )
      ).rows;
      const unavailable = (
        await ctx.pool.query(
          `SELECT id, officer_id AS "officerId", starts_at AS "startsAt", ends_at AS "endsAt", category
             FROM personnel_unavailability WHERE officer_id = ANY($1::uuid[]) AND cancelled_at IS NULL
              AND tstzrange(starts_at, ends_at) && tstzrange($2, $3)`,
          [ids, from, to],
        )
      ).rows as { officerId: string; startsAt: Date; endsAt: Date; id: string }[];
      // Conflicts: overlapping open duties for one person, or a duty during recorded unavailability.
      const conflicts: { officerId: string; kind: string; a: string; b: string }[] = [];
      const open = duties.filter((d) => !['COMPLETED', 'CANCELLED'].includes(d.status));
      for (let i = 0; i < open.length; i++)
        for (let j = i + 1; j < open.length; j++) {
          const x = open[i]!;
          const y = open[j]!;
          if (x.officerId === y.officerId && x.plannedStart < y.plannedEnd && y.plannedStart < x.plannedEnd)
            conflicts.push({ officerId: x.officerId, kind: 'OVERLAPPING_DUTIES', a: x.assignmentId, b: y.assignmentId });
        }
      for (const d of open)
        for (const un of unavailable)
          if (d.officerId === un.officerId && d.plannedStart < un.endsAt && un.startsAt < d.plannedEnd)
            conflicts.push({ officerId: d.officerId, kind: 'DUTY_DURING_UNAVAILABILITY', a: d.assignmentId, b: un.id });
      res.json({ from: from.toISOString(), to: to.toISOString(), personnel: people, duties, unavailability: unavailable, conflicts });
    }),
  );
  return r;
}

/** Check-ins & presence records (device-reported vs server-received times, location provenance). */
export function checkinRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    requirePermission('checkin.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = pageQuery
        .extend({
          status: z.enum(['SCHEDULED', 'PRESENTED', 'ACKNOWLEDGED', 'ACKNOWLEDGED_LATE', 'MISSED', 'EXCEPTIONS']).optional(),
          category: z.enum(DUTY_CATEGORIES).optional(),
          assignmentId: uuidParam.optional(),
          officerId: uuidParam.optional(),
          from: isoQuery.optional(),
          to: isoQuery.optional(),
        })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      const where = [
        officerScopeSql(u, 'k.officer_id', args),
        restrictedSessionFilterSql(u, 'k.duty_session_id', 'k.officer_id', args),
      ];
      const push = (sql: string, v: unknown) => {
        args.push(v);
        where.push(sql.replaceAll('?', `$${args.length}`));
      };
      if (q.status === 'EXCEPTIONS') where.push("k.status IN ('MISSED','ACKNOWLEDGED_LATE')");
      else if (q.status) push('k.status = ?', q.status);
      if (q.category) push('a.category = ?', q.category);
      if (q.assignmentId) push('a.id = ?', q.assignmentId);
      if (q.officerId) push('k.officer_id = ?', q.officerId);
      if (q.from) push('k.scheduled_for >= ?', new Date(q.from));
      if (q.to) push('k.scheduled_for <= ?', new Date(q.to));
      const base = `FROM checkins k JOIN officers o ON o.id = k.officer_id
        LEFT JOIN duty_assignment_personnel dp ON dp.duty_session_id = k.duty_session_id
        LEFT JOIN duty_assignments a ON a.id = dp.assignment_id WHERE ${where.join(' AND ')}`;
      const total = (await ctx.pool.query<{ n: number }>(`SELECT count(*)::int n ${base}`, args)).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT k.checkin_id AS "checkinId", k.officer_id AS "officerId", o.display_name AS "officerName", o.is_demo AS "isDemo",
            k.duty_session_id AS "dutySessionId", a.id AS "assignmentId", a.reference_code AS "dutyReference", a.category AS "dutyCategory",
            k.scheduled_for AS "scheduledForDevice", k.deadline_at AS "deadlineDevice", k.status, k.biometric_result AS "biometricResult",
            k.challenge_result AS "challengeResult", k.response_ms AS "responseMs", k.late_by_ms AS "lateByMs", k.missed_reason AS "missedReason",
            (SELECT max(de.server_received_at) FROM device_events de WHERE de.event_id = ANY(k.event_ids)) AS "serverReceivedAt",
            (SELECT json_build_object('latitude', ST_Y(pl.location::geometry), 'longitude', ST_X(pl.location::geometry),
                'horizontalAccuracyM', pl.horizontal_accuracy_m, 'spatialResult', pl.spatial_result, 'mockIndicator', pl.mock_indicator,
                'recordedDeviceTime', pl.recorded_device_time, 'eventType', pl.event_type)
               FROM patrol_logs pl WHERE pl.event_id = ANY(k.event_ids) AND pl.location IS NOT NULL ORDER BY pl.recorded_device_time DESC LIMIT 1) AS location,
            (SELECT count(*)::int FROM record_corrections rc WHERE rc.target_type = 'CHECKIN' AND rc.target_id = k.checkin_id) AS "corrections",
            (SELECT rc.corrected_value FROM record_corrections rc WHERE rc.target_type = 'CHECKIN' AND rc.target_id = k.checkin_id AND rc.status = 'APPROVED' AND rc.field_name = 'status' ORDER BY rc.decided_at DESC LIMIT 1) AS "approvedStatusCorrection"
          ${base} ORDER BY k.scheduled_for DESC NULLS LAST LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );
  return r;
}

const CORRECTABLE: Record<string, string[]> = {
  CHECKIN: ['status', 'missed_reason'],
  DUTY_PERSONNEL: ['reported_start', 'attendance_note'],
  EVIDENCE: ['capture_device_time'],
};

async function readOriginal(
  c: { query: AppContext['pool']['query'] },
  targetType: string,
  targetId: string,
  field: string,
): Promise<{ officerId: string; value: unknown; sessionId: string | null } | null> {
  if (targetType === 'CHECKIN') {
    const r = (
      await c.query<{ officer_id: string; status: string; missed_reason: string | null; duty_session_id: string | null }>(
        'SELECT officer_id, status, missed_reason, duty_session_id FROM checkins WHERE checkin_id = $1',
        [targetId],
      )
    ).rows[0];
    return r ? { officerId: r.officer_id, value: field === 'status' ? r.status : r.missed_reason, sessionId: r.duty_session_id } : null;
  }
  if (targetType === 'DUTY_PERSONNEL') {
    const r = (
      await c.query<{ officer_id: string; device_started_at: Date | null; duty_session_id: string | null }>(
        `SELECT p.officer_id, s.device_started_at, p.duty_session_id FROM duty_assignment_personnel p LEFT JOIN duty_sessions s ON s.id = p.duty_session_id WHERE p.id = $1`,
        [targetId],
      )
    ).rows[0];
    return r
      ? { officerId: r.officer_id, value: field === 'reported_start' ? (r.device_started_at?.toISOString() ?? null) : null, sessionId: r.duty_session_id }
      : null;
  }
  const r = (
    await c.query<{ officer_id: string; manifest: { capture?: { deviceWallTime?: string } }; duty_session_id: string | null }>(
      'SELECT officer_id, manifest, duty_session_id FROM evidence_objects WHERE evidence_id = $1',
      [targetId],
    )
  ).rows[0];
  return r ? { officerId: r.officer_id, value: r.manifest?.capture?.deviceWallTime ?? null, sessionId: r.duty_session_id } : null;
}

/**
 * Audited corrections. Historical attendance/check-in/evidence values are never overwritten:
 * the server records the original it read, the proposed value, reason and approval decision.
 */
export function correctionRoutes(ctx: AppContext): Router {
  const r = Router();
  const cols = `rc.id, rc.target_type AS "targetType", rc.target_id AS "targetId", rc.field_name AS "fieldName",
    rc.original_value AS "originalValue", rc.corrected_value AS "correctedValue", rc.reason, rc.status,
    rc.requested_at AS "requestedAt", ru.display_name AS "requestedByName", rc.requested_by AS "requestedBy",
    rc.decided_at AS "decidedAt", du.display_name AS "decidedByName", rc.decision_note AS "decisionNote"`;

  async function targetOfficer(u: AuthUser, targetType: string, targetId: string): Promise<string | null> {
    const o = await readOriginal(ctx.pool, targetType, targetId, CORRECTABLE[targetType]![0]!);
    return o?.officerId ?? null;
  }

  r.get(
    '/',
    requireAnyPermission('correction.request', 'correction.approve'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = pageQuery
        .extend({
          status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
          targetId: uuidParam.optional(),
        })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      const where: string[] = [];
      if (can(u, 'correction.approve')) {
        const sc = officerScopeSql(u, 'tgt.officer_id', args);
        where.push(`(rc.requested_by = $${args.push(u.id)} OR EXISTS (SELECT 1 FROM (
            SELECT officer_id FROM checkins WHERE rc.target_type = 'CHECKIN' AND checkin_id = rc.target_id
            UNION ALL SELECT officer_id FROM duty_assignment_personnel WHERE rc.target_type = 'DUTY_PERSONNEL' AND id = rc.target_id
            UNION ALL SELECT officer_id FROM evidence_objects WHERE rc.target_type = 'EVIDENCE' AND evidence_id = rc.target_id) tgt WHERE ${sc}))`);
      } else {
        args.push(u.id);
        where.push(`rc.requested_by = $${args.length}`);
      }
      if (q.status) {
        args.push(q.status);
        where.push(`rc.status = $${args.length}`);
      }
      if (q.targetId) {
        args.push(q.targetId);
        where.push(`rc.target_id = $${args.length}`);
      }
      const w = `WHERE ${where.join(' AND ')}`;
      const total = (await ctx.pool.query<{ n: number }>(`SELECT count(*)::int n FROM record_corrections rc ${w}`, args)).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT ${cols} FROM record_corrections rc JOIN app_users ru ON ru.id = rc.requested_by LEFT JOIN app_users du ON du.id = rc.decided_by ${w}
          ORDER BY rc.requested_at DESC LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );

  r.post(
    '/',
    requirePermission('correction.request'),
    h(async (req, res) => {
      const u = authUser(req);
      const b = z
        .object({
          targetType: z.enum(['CHECKIN', 'DUTY_PERSONNEL', 'EVIDENCE']),
          targetId: uuidParam,
          fieldName: z.string().max(40),
          correctedValue: z.union([z.string().max(300), z.null()]),
          reason: z.string().trim().min(5).max(500),
        })
        .strict()
        .parse(req.body);
      if (!CORRECTABLE[b.targetType]!.includes(b.fieldName))
        throw new AppError(400, 'VALIDATION_FAILED', `Field ${b.fieldName} cannot be corrected for ${b.targetType}.`, {
          allowed: CORRECTABLE[b.targetType],
        });
      const id = randomUUID();
      await withTransaction(ctx.pool, async (c) => {
        const orig = await readOriginal(c, b.targetType, b.targetId, b.fieldName);
        if (!orig) throw new AppError(404, 'NOT_FOUND', 'Record not found.');
        await assertOfficerInScope(c, u, orig.officerId);
        await c.query(
          `INSERT INTO record_corrections (id, target_type, target_id, field_name, original_value, corrected_value, reason, requested_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [id, b.targetType, b.targetId, b.fieldName, JSON.stringify(orig.value), JSON.stringify(b.correctedValue), b.reason, u.id],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'CORRECTION_REQUESTED',
          targetType: b.targetType.toLowerCase(),
          targetId: b.targetId,
          requestId: reqId(req),
          details: { correctionId: id, field: b.fieldName, original: orig.value, corrected: b.correctedValue, reason: b.reason },
        });
      });
      res.status(201).json({ id, status: 'PENDING' });
    }),
  );

  r.post(
    '/:id/decide',
    requirePermission('correction.approve'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      const b = z
        .object({ decision: z.enum(['APPROVE', 'REJECT']), note: z.string().trim().min(3).max(500) })
        .strict()
        .parse(req.body);
      await withTransaction(ctx.pool, async (c) => {
        const rc = (
          await c.query<{ status: string; requested_by: string; target_type: string; target_id: string; field_name: string }>(
            'SELECT status, requested_by, target_type, target_id, field_name FROM record_corrections WHERE id = $1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!rc) throw new AppError(404, 'NOT_FOUND', 'Correction not found.');
        const officer = await targetOfficer(u, rc.target_type, rc.target_id);
        if (!officer) throw new AppError(404, 'NOT_FOUND', 'Correction not found.');
        await assertOfficerInScope(c, u, officer);
        if (rc.requested_by === u.id)
          throw new AppError(403, 'SELF_MODIFICATION_FORBIDDEN', 'A correction must be decided by someone other than the requester.');
        if (rc.status !== 'PENDING') throw new AppError(409, 'CONFLICT', 'Correction already decided.');
        await c.query(
          'UPDATE record_corrections SET status = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1',
          [id, b.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED', u.id, b.note],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: b.decision === 'APPROVE' ? 'CORRECTION_APPROVED' : 'CORRECTION_REJECTED',
          targetType: rc.target_type.toLowerCase(),
          targetId: rc.target_id,
          requestId: reqId(req),
          details: { correctionId: id, field: rc.field_name, note: b.note },
        });
        await notifyUsers(c, ctx.bus, [rc.requested_by], {
          kind: 'CORRECTION',
          title: `Correction ${b.decision === 'APPROVE' ? 'approved' : 'rejected'}`,
          body: b.note,
          relatedType: 'correction',
          relatedId: id,
          dedupeKey: `corr:${id}`,
        });
      });
      res.json({ ok: true });
    }),
  );
  return r;
}
