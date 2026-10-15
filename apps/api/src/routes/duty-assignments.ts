import { Router, type Request } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import {
  assertPermission,
  authUser,
  can,
  h,
  requirePermission,
  type AuthUser,
} from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import {
  assertOfficerInScope,
  assignmentInScope,
  assignmentScopeSql,
  canSeeRestrictedDetails,
  unitScopeSql,
} from '../security/access.js';
import {
  acceptAssignment,
  acknowledgeHandover,
  acknowledgeInstructions,
  addPersonnel,
  assignmentWarnings,
  createAssignment,
  DUTY_CATEGORIES,
  DUTY_STATUSES,
  findConflicts,
  publishInstructions,
  recordHandover,
  removePersonnel,
  replacePersonnel,
  transition,
  TRANSITIONS,
  updateAssignment,
  type Actor,
  type DutyStatus,
} from '../services/duties.js';
import { isoQuery, pageQuery, pageResult, paging, param, uuidParam } from './common.js';

const text = (max: number) => z.string().trim().min(1).max(max);
const iso = isoQuery.transform((v) => new Date(v));

const personnelInput = z
  .object({ officerId: uuidParam, roleInDuty: z.enum(['LEAD', 'MEMBER']).optional() })
  .strict();

const createSchema = z
  .object({
    category: z.enum(DUTY_CATEGORIES),
    title: z.string().trim().min(3).max(120),
    unitId: uuidParam,
    plannedStart: iso,
    plannedEnd: iso,
    reportingLocation: text(160).nullable().optional(),
    trainRef: text(60).nullable().optional(),
    stationUnitId: uuidParam.nullable().optional(),
    escortLabel: text(80).nullable().optional(),
    incidentRef: text(60).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    supervisorOfficerId: uuidParam.nullable().optional(),
    acceptRequired: z.boolean().optional(),
    personnel: z.array(personnelInput).max(50).optional(),
    allowConflict: z.boolean().optional(),
    overrideReason: z.string().max(500).optional(),
    publish: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.category === 'STATION_WATCH' && !v.stationUnitId)
      ctx.addIssue({ code: 'custom', path: ['stationUnitId'], message: 'Station watch requires a station.' });
    if (v.category === 'VIP_ESCORT' && !v.escortLabel)
      ctx.addIssue({ code: 'custom', path: ['escortLabel'], message: 'VIP escort requires an escort label (synthetic in demos).' });
    if (v.category === 'TRACK_INCIDENT' && !v.incidentRef)
      ctx.addIssue({ code: 'custom', path: ['incidentRef'], message: 'Track incident requires an incident reference.' });
  });

const updateSchema = z
  .object({
    plannedStart: iso.optional(),
    plannedEnd: iso.optional(),
    title: z.string().trim().min(3).max(120).optional(),
    reportingLocation: text(160).nullable().optional(),
    trainRef: text(60).nullable().optional(),
    stationUnitId: uuidParam.nullable().optional(),
    escortLabel: text(80).nullable().optional(),
    incidentRef: text(60).nullable().optional(),
    notes: z.string().max(1000).nullable().optional(),
    supervisorOfficerId: uuidParam.nullable().optional(),
    reason: z.string().max(500).optional(),
    allowConflict: z.boolean().optional(),
  })
  .strict();

const listQuery = pageQuery.extend({
  category: z.enum(DUTY_CATEGORIES).optional(),
  status: z.enum([...DUTY_STATUSES, 'OPEN']).optional(),
  unitId: uuidParam.optional(),
  officerId: uuidParam.optional(),
  from: isoQuery.optional(),
  to: isoQuery.optional(),
  q: z.string().max(60).optional(),
});

function actorOf(req: Request): Actor & { id: string } {
  const u = authUser(req);
  return { id: u.id, role: u.role, requestId: reqId(req) };
}

/** SQL expression: may the current user see restricted details of assignment alias `a`? */
function showSql(u: AuthUser, args: unknown[]): string {
  args.push(u.permissions.has('duty.view_restricted'));
  const canR = `$${args.length}::boolean`;
  args.push(u.officerId);
  return `(NOT c.is_restricted OR ${canR} OR EXISTS (SELECT 1 FROM duty_assignment_personnel vp WHERE vp.assignment_id = a.id AND vp.officer_id = $${args.length}::uuid))`;
}

function listCols(show: string): string {
  return `a.id, a.reference_code AS "referenceCode", a.category, c.label AS "categoryLabel", c.is_restricted AS "isRestricted",
    ${show} AS "detailsVisible",
    CASE WHEN ${show} THEN a.title ELSE c.label || ' (restricted details)' END AS title,
    a.unit_id AS "unitId", un.name AS "unitName", a.planned_start AS "plannedStart", a.planned_end AS "plannedEnd", a.status,
    CASE WHEN ${show} THEN a.reporting_location END AS "reportingLocation",
    CASE WHEN ${show} THEN a.train_ref END AS "trainRef",
    st.name AS "stationName",
    CASE WHEN ${show} THEN a.escort_label END AS "escortLabel",
    CASE WHEN ${show} THEN a.incident_ref END AS "incidentRef",
    sv.display_name AS "supervisorName", a.is_demo AS "isDemo", a.created_at AS "createdAt", a.updated_at AS "updatedAt",
    COALESCE((SELECT json_agg(json_build_object('personnelId', p.id, 'officerId', p.officer_id, 'name', o.display_name,
        'personnelClass', p.personnel_class, 'roleInDuty', p.role_in_duty, 'status', p.status) ORDER BY p.role_in_duty, o.display_name)
      FROM duty_assignment_personnel p JOIN officers o ON o.id = p.officer_id WHERE p.assignment_id = a.id AND p.status IN ('ASSIGNED','ACCEPTED')), '[]') AS personnel,
    (SELECT count(*)::int FROM review_flags f WHERE f.duty_assignment_id = a.id AND f.status IN ('OPEN','ACKNOWLEDGED','ASSIGNED')) AS "openExceptions",
    (SELECT count(*)::int FROM review_flags f WHERE f.duty_assignment_id = a.id AND f.flag_type = 'ASSIGNMENT_CONFLICT' AND f.status IN ('OPEN','ACKNOWLEDGED','ASSIGNED')) AS "openConflicts",
    (SELECT count(*)::int FROM checkins k JOIN duty_assignment_personnel kp ON kp.duty_session_id = k.duty_session_id WHERE kp.assignment_id = a.id AND k.status IN ('ACKNOWLEDGED','ACKNOWLEDGED_LATE')) AS "checkinsAcknowledged",
    (SELECT count(*)::int FROM checkins k JOIN duty_assignment_personnel kp ON kp.duty_session_id = k.duty_session_id WHERE kp.assignment_id = a.id AND k.status = 'MISSED') AS "checkinsMissed"`;
}

const FROM = `FROM duty_assignments a JOIN duty_categories c ON c.code = a.category JOIN units un ON un.id = a.unit_id
  LEFT JOIN units st ON st.id = a.station_unit_id LEFT JOIN officers sv ON sv.id = a.supervisor_officer_id`;

export function dutyAssignmentRoutes(ctx: AppContext): Router {
  const r = Router();

  async function assertInScope(u: AuthUser, id: string): Promise<void> {
    if (!(await assignmentInScope(ctx.pool, u, id)))
      throw new AppError(404, 'NOT_FOUND', 'Duty assignment not found.');
  }

  async function loadDetail(u: AuthUser, id: string) {
    const args: unknown[] = [id];
    const show = showSql(u, args);
    const row = (
      await ctx.pool.query<Record<string, unknown> & { detailsVisible: boolean; status: DutyStatus; category: string }>(
        `SELECT ${listCols(show)}, CASE WHEN ${show} THEN a.notes END AS notes, a.accept_required AS "acceptRequired",
            a.supervisor_officer_id AS "supervisorOfficerId", a.station_unit_id AS "stationUnitId", a.completion_note AS "completionNote",
            a.completed_at AS "completedAt", a.cancelled_reason AS "cancelledReason", a.version, a.policy_version AS "policyVersion",
            cu.display_name AS "createdByName",
            json_build_object('minIntervalMin', c.checkin_min_interval_min, 'maxIntervalMin', c.checkin_max_interval_min,
              'responseWindowSec', c.response_window_sec, 'reportingWindowMin', c.reporting_window_min, 'graceMin', c.grace_min) AS "checkinPolicy"
           ${FROM} JOIN app_users cu ON cu.id = a.created_by WHERE a.id = $1`,
        args,
      )
    ).rows[0];
    if (!row) throw new AppError(404, 'NOT_FOUND', 'Duty assignment not found.');
    const visible = row.detailsVisible;
    const [people, instructions, handovers, changes, exceptions, evidence] = await Promise.all([
      ctx.pool.query(
        `SELECT p.id AS "personnelId", p.officer_id AS "officerId", o.display_name AS name, o.employee_ref AS "personnelRef",
            p.personnel_class AS "personnelClass", p.role_in_duty AS "roleInDuty", p.status, p.assigned_at AS "assignedAt",
            p.accepted_at AS "acceptedAt", p.removed_at AS "removedAt", p.removal_reason AS "removalReason",
            p.conflict_override_reason AS "conflictOverrideReason", o.is_active AS "isActive",
            p.duty_session_id AS "dutySessionId", s.status AS "sessionStatus",
            s.device_started_at AS "deviceReportedStart", s.server_started_received_at AS "serverReceivedStart", s.device_ended_at AS "deviceReportedEnd",
            (SELECT count(*)::int FROM checkins k WHERE k.duty_session_id = p.duty_session_id AND k.status IN ('ACKNOWLEDGED','ACKNOWLEDGED_LATE')) AS "checkinsAcknowledged",
            (SELECT count(*)::int FROM checkins k WHERE k.duty_session_id = p.duty_session_id AND k.status = 'ACKNOWLEDGED_LATE') AS "checkinsLate",
            (SELECT count(*)::int FROM checkins k WHERE k.duty_session_id = p.duty_session_id AND k.status = 'MISSED') AS "checkinsMissed",
            (SELECT max(dv.last_seen_at) FROM devices dv WHERE dv.officer_id = p.officer_id) AS "lastDeviceSyncAt"
           FROM duty_assignment_personnel p JOIN officers o ON o.id = p.officer_id LEFT JOIN duty_sessions s ON s.id = p.duty_session_id
          WHERE p.assignment_id = $1 ORDER BY p.assigned_at`,
        [id],
      ),
      ctx.pool.query(
        `SELECT i.id, i.version, ${visible ? 'i.body' : 'NULL AS body'}, i.body_sha256 AS "bodySha256", i.published_at AS "publishedAt",
            pu.display_name AS "publishedByName",
            COALESCE((SELECT json_agg(json_build_object('officerId', k.officer_id, 'name', ko.display_name, 'acknowledgedAt', k.acknowledged_at))
              FROM duty_instruction_acks k JOIN officers ko ON ko.id = k.officer_id WHERE k.instruction_id = i.id), '[]') AS acknowledgements
           FROM duty_instructions i JOIN app_users pu ON pu.id = i.published_by WHERE i.assignment_id = $1 ORDER BY i.version DESC`,
        [id],
      ),
      ctx.pool.query(
        `SELECT hd.id, hd.handover_at AS "handoverAt", hd.outgoing_officer_id AS "outgoingOfficerId", oo.display_name AS "outgoingName",
            hd.incoming_officer_id AS "incomingOfficerId", io.display_name AS "incomingName",
            ${visible ? 'hd.outstanding_tasks' : 'NULL'} AS "outstandingTasks", hd.outgoing_ack_at AS "outgoingAckAt", hd.incoming_ack_at AS "incomingAckAt",
            ru.display_name AS "recordedByName", hd.recorded_at AS "recordedAt"
           FROM duty_handovers hd JOIN officers oo ON oo.id = hd.outgoing_officer_id JOIN officers io ON io.id = hd.incoming_officer_id
           JOIN app_users ru ON ru.id = hd.recorded_by WHERE hd.assignment_id = $1 ORDER BY hd.handover_at`,
        [id],
      ),
      ctx.pool.query(
        `SELECT ch.id, ch.change_type AS "changeType", ${visible ? 'ch.before_value' : 'NULL'} AS "before", ${visible ? 'ch.after_value' : 'NULL'} AS "after",
            ch.reason, ch.occurred_at AS "occurredAt", COALESCE(cu.display_name, 'System') AS "actorName"
           FROM duty_assignment_changes ch LEFT JOIN app_users cu ON cu.id = ch.actor_user_id WHERE ch.assignment_id = $1 ORDER BY ch.seq`,
        [id],
      ),
      can(u, 'exception.view') || u.scope.level === 'SELF'
        ? ctx.pool.query(
            `SELECT f.id, f.flag_type AS "flagType", f.severity, f.status, f.title, f.created_at AS "createdAt", o.display_name AS "officerName"
               FROM review_flags f LEFT JOIN officers o ON o.id = f.officer_id
              WHERE f.duty_assignment_id = $1 ${u.scope.level === 'SELF' ? 'AND f.officer_id = $2' : ''} ORDER BY f.created_at DESC LIMIT 100`,
            u.scope.level === 'SELF' ? [id, u.officerId] : [id],
          )
        : Promise.resolve({ rows: [] }),
      ctx.pool.query(
        `SELECT e.evidence_id AS "evidenceId", e.status, e.officer_id AS "officerId", o.display_name AS "officerName", e.created_at AS "createdAt",
            e.upload_attempts AS "uploadAttempts"
           FROM evidence_objects e JOIN officers o ON o.id = e.officer_id JOIN duty_assignment_personnel p ON p.duty_session_id = e.duty_session_id
          WHERE p.assignment_id = $1 ${u.scope.level === 'SELF' ? 'AND e.officer_id = $2' : ''} ORDER BY e.created_at DESC LIMIT 200`,
        u.scope.level === 'SELF' ? [id, u.officerId] : [id],
      ),
    ]);
    const status = row.status;
    const allowed = TRANSITIONS[status].filter((t) => {
      if (t === 'ACCEPTED') return false; // reached through acceptance by assigned personnel
      if (t === 'ASSIGNED') return can(u, 'duty.approve');
      if (t === 'EXCEPTION_REPORTED')
        return can(u, 'duty.close') || people.rows.some((p) => p.officerId === u.officerId && ['ASSIGNED', 'ACCEPTED'].includes(String(p.status)));
      return can(u, 'duty.close');
    });
    const me = people.rows.find((p) => p.officerId === u.officerId && ['ASSIGNED', 'ACCEPTED'].includes(String(p.status)));
    return {
      ...row,
      personnelHistory: people.rows,
      instructions: instructions.rows,
      handovers: handovers.rows,
      changes: changes.rows,
      exceptions: exceptions.rows,
      evidence: evidence.rows,
      warnings: can(u, 'duty.view') && u.scope.level !== 'SELF' ? await assignmentWarnings(ctx.pool, id) : [],
      myAssignment: me ? { personnelId: me.personnelId, status: me.status } : null,
      actions: {
        allowedTransitions: allowed,
        canEdit: can(u, 'duty.assign') && ['DRAFT', 'ASSIGNED', 'ACCEPTED'].includes(status),
        canAssign: can(u, 'duty.assign') && !['COMPLETED', 'CANCELLED'].includes(status),
        canPublishInstructions: can(u, 'duty.instructions.publish') && !['COMPLETED', 'CANCELLED'].includes(status),
        canRecordHandover:
          (can(u, 'duty.handover.record') || !!me) &&
          ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'EXCEPTION_REPORTED'].includes(status),
        canAccept: !!me && me.status === 'ASSIGNED' && ['ASSIGNED', 'ACCEPTED'].includes(status),
        canOverrideConflicts: can(u, 'duty.approve'),
      },
    };
  }

  r.get(
    '/',
    requirePermission('duty.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = listQuery.parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      const where = [assignmentScopeSql(u, 'a', args)];
      const push = (sql: string, v: unknown) => {
        args.push(v);
        where.push(sql.replaceAll('?', `$${args.length}`));
      };
      if (q.category) push('a.category = ?', q.category);
      if (q.status === 'OPEN') where.push("a.status NOT IN ('COMPLETED','CANCELLED')");
      else if (q.status) push('a.status = ?', q.status);
      if (q.unitId) push('(a.unit_id = ? OR a.station_unit_id = ?)', q.unitId);
      if (q.officerId)
        push('EXISTS (SELECT 1 FROM duty_assignment_personnel fp WHERE fp.assignment_id = a.id AND fp.officer_id = ?)', q.officerId);
      if (q.from) push('a.planned_end >= ?', new Date(q.from));
      if (q.to) push('a.planned_start <= ?', new Date(q.to));
      if (q.q) push('(a.reference_code ILIKE ? OR (NOT c.is_restricted AND a.title ILIKE ?))', `%${q.q}%`);
      const w = `WHERE ${where.join(' AND ')}`;
      const total = (
        await ctx.pool.query<{ n: number }>(
          `SELECT count(*)::int n FROM duty_assignments a JOIN duty_categories c ON c.code = a.category ${w}`,
          args,
        )
      ).rows[0]!.n;
      const show = showSql(u, args);
      const { rows } = await ctx.pool.query(
        `SELECT ${listCols(show)} ${FROM} ${w} ORDER BY a.planned_start DESC, a.reference_code LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );

  r.get(
    '/:id',
    requirePermission('duty.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      res.json(await loadDetail(u, id));
    }),
  );

  /** Conflict preview for the assignment form (does not change anything). */
  r.get(
    '/:id/conflicts',
    requirePermission('duty.assign'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      const { officerId } = z.object({ officerId: uuidParam }).parse(req.query);
      await assertOfficerInScope(ctx.pool, u, officerId);
      const a = (
        await ctx.pool.query<{ planned_start: Date; planned_end: Date }>(
          'SELECT planned_start, planned_end FROM duty_assignments WHERE id = $1',
          [id],
        )
      ).rows[0]!;
      res.json({ conflicts: await findConflicts(ctx.pool, officerId, a.planned_start, a.planned_end, id) });
    }),
  );

  r.post(
    '/',
    requirePermission('duty.create'),
    h(async (req, res) => {
      const u = authUser(req);
      const b = createSchema.parse(req.body);
      if (b.personnel?.length) assertPermission(u, 'duty.assign');
      if (b.publish) assertPermission(u, 'duty.approve');
      const args: unknown[] = [b.unitId];
      const unitOk = await ctx.pool.query(`SELECT 1 FROM units WHERE id = $1 AND ${unitScopeSql(u, 'id', args)}`, args);
      if (!unitOk.rowCount) throw new AppError(403, 'FORBIDDEN', 'The unit is outside your configured scope.');
      for (const p of b.personnel ?? []) await assertOfficerInScope(ctx.pool, u, p.officerId);
      const actor = actorOf(req);
      const out = await withTransaction(ctx.pool, async (c) => {
        const id = await createAssignment(c, actor, {
          category: b.category,
          title: b.title,
          unitId: b.unitId,
          plannedStart: b.plannedStart,
          plannedEnd: b.plannedEnd,
          reportingLocation: b.reportingLocation ?? null,
          trainRef: b.trainRef ?? null,
          stationUnitId: b.stationUnitId ?? null,
          escortLabel: b.escortLabel ?? null,
          incidentRef: b.incidentRef ?? null,
          notes: b.notes ?? null,
          supervisorOfficerId: b.supervisorOfficerId ?? null,
          acceptRequired: b.acceptRequired,
        });
        const warnings: string[] = [];
        for (const p of b.personnel ?? []) {
          const added = await addPersonnel(c, ctx.bus, actor, id, {
            officerId: p.officerId,
            roleInDuty: p.roleInDuty,
            allowConflict: b.allowConflict,
            overrideReason: b.overrideReason ?? null,
            canOverride: can(u, 'duty.approve'),
          });
          warnings.push(...added.warnings);
        }
        if (b.publish) await transition(c, ctx.bus, actor, id, { to: 'ASSIGNED' });
        return { id, warnings };
      });
      res.status(201).json({ ...(await loadDetail(u, out.id)), creationWarnings: out.warnings });
    }),
  );

  r.patch(
    '/:id',
    requirePermission('duty.assign'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      const b = updateSchema.parse(req.body);
      if (b.supervisorOfficerId) await assertOfficerInScope(ctx.pool, u, b.supervisorOfficerId);
      const out = await withTransaction(ctx.pool, (c) =>
        updateAssignment(c, ctx.bus, actorOf(req), id, { ...b, canOverride: can(u, 'duty.approve') }),
      );
      res.json({ ...(await loadDetail(u, id)), conflicts: out.conflicts });
    }),
  );

  r.post(
    '/:id/personnel',
    requirePermission('duty.assign'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      const b = z
        .object({
          officerId: uuidParam,
          roleInDuty: z.enum(['LEAD', 'MEMBER']).optional(),
          allowConflict: z.boolean().optional(),
          overrideReason: z.string().max(500).optional(),
          reason: z.string().max(500).optional(),
        })
        .strict()
        .parse(req.body);
      await assertOfficerInScope(ctx.pool, u, b.officerId);
      const out = await withTransaction(ctx.pool, (c) =>
        addPersonnel(c, ctx.bus, actorOf(req), id, { ...b, canOverride: can(u, 'duty.approve') }),
      );
      res.status(201).json(out);
    }),
  );

  r.post(
    '/:id/personnel/:pid/remove',
    requirePermission('duty.assign'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      const { reason } = z.object({ reason: z.string().trim().min(5).max(500) }).strict().parse(req.body);
      await withTransaction(ctx.pool, (c) =>
        removePersonnel(c, ctx.bus, actorOf(req), id, param(req, 'pid'), reason),
      );
      res.json({ ok: true });
    }),
  );

  r.post(
    '/:id/personnel/:pid/replace',
    requirePermission('duty.assign'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      const b = z
        .object({
          officerId: uuidParam,
          reason: z.string().trim().min(5).max(500),
          allowConflict: z.boolean().optional(),
          overrideReason: z.string().max(500).optional(),
        })
        .strict()
        .parse(req.body);
      await assertOfficerInScope(ctx.pool, u, b.officerId);
      const out = await withTransaction(ctx.pool, (c) =>
        replacePersonnel(c, ctx.bus, actorOf(req), id, param(req, 'pid'), {
          ...b,
          canOverride: can(u, 'duty.approve'),
        }),
      );
      res.json(out);
    }),
  );

  r.post(
    '/:id/status',
    requirePermission('duty.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      const b = z
        .object({
          to: z.enum(['ASSIGNED', 'IN_PROGRESS', 'COMPLETED', 'EXCEPTION_REPORTED', 'CANCELLED']),
          reason: z.string().max(500).optional(),
          completionNote: z.string().max(1000).optional(),
        })
        .strict()
        .parse(req.body);
      if (b.to === 'ASSIGNED') assertPermission(u, 'duty.approve');
      else if (b.to === 'EXCEPTION_REPORTED') {
        if (!can(u, 'duty.close')) {
          const mine = u.officerId
            ? await ctx.pool.query(
                "SELECT 1 FROM duty_assignment_personnel WHERE assignment_id = $1 AND officer_id = $2 AND status IN ('ASSIGNED','ACCEPTED')",
                [id, u.officerId],
              )
            : { rowCount: 0 };
          if (!mine.rowCount) throw new AppError(403, 'FORBIDDEN', 'You are not authorised to perform this action.');
        }
      } else assertPermission(u, 'duty.close');
      const status = await withTransaction(ctx.pool, (c) =>
        transition(c, ctx.bus, actorOf(req), id, {
          to: b.to,
          reason: b.reason ?? (b.to === 'IN_PROGRESS' ? 'Marked in progress by a supervisor (not proof of attendance).' : null),
          completionNote: b.completionNote ?? null,
        }),
      );
      res.json({ id, status });
    }),
  );

  r.post(
    '/:id/accept',
    requirePermission('duty.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      if (!u.officerId) throw new AppError(403, 'FORBIDDEN', 'Only assigned personnel can accept a duty.');
      await assertInScope(u, id);
      const out = await withTransaction(ctx.pool, (c) => acceptAssignment(c, ctx.bus, actorOf(req), u.officerId!, id));
      res.json(out);
    }),
  );

  r.post(
    '/:id/instructions',
    requirePermission('duty.instructions.publish'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      const { body } = z.object({ body: z.string().trim().min(3).max(4000) }).strict().parse(req.body);
      const out = await withTransaction(ctx.pool, (c) => publishInstructions(c, ctx.bus, actorOf(req), id, body));
      res.status(201).json(out);
    }),
  );

  r.post(
    '/instructions/:iid/acknowledge',
    requirePermission('duty.view'),
    h(async (req, res) => {
      const u = authUser(req);
      if (!u.officerId) throw new AppError(403, 'FORBIDDEN', 'Only assigned personnel acknowledge instructions.');
      await withTransaction(ctx.pool, (c) =>
        acknowledgeInstructions(c, actorOf(req), u.officerId!, param(req, 'iid')),
      );
      res.json({ ok: true });
    }),
  );

  r.post(
    '/:id/handovers',
    requirePermission('duty.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertInScope(u, id);
      const b = z
        .object({
          outgoingOfficerId: uuidParam,
          incomingOfficerId: uuidParam,
          handoverAt: iso,
          outstandingTasks: z.string().max(2000).optional(),
        })
        .strict()
        .parse(req.body);
      if (!can(u, 'duty.handover.record') && b.outgoingOfficerId !== u.officerId)
        throw new AppError(403, 'FORBIDDEN', 'Only the outgoing person or an authorised supervisor can record a handover.');
      if (!(await canSeeRestrictedDetails(ctx.pool, u, id))) {
        const restricted = await ctx.pool.query(
          'SELECT 1 FROM duty_assignments a JOIN duty_categories c ON c.code = a.category WHERE a.id = $1 AND c.is_restricted',
          [id],
        );
        if (restricted.rowCount) throw new AppError(404, 'NOT_FOUND', 'Duty assignment not found.');
      }
      const out = await withTransaction(ctx.pool, (c) => recordHandover(c, ctx.bus, actorOf(req), id, b));
      res.status(201).json(out);
    }),
  );

  r.post(
    '/handovers/:hid/acknowledge',
    requirePermission('duty.view'),
    h(async (req, res) => {
      const u = authUser(req);
      if (!u.officerId) throw new AppError(403, 'FORBIDDEN', 'Only involved personnel acknowledge a handover.');
      const side = await withTransaction(ctx.pool, (c) =>
        acknowledgeHandover(c, actorOf(req), u.officerId!, param(req, 'hid')),
      );
      res.json({ ok: true, side });
    }),
  );
  return r;
}
