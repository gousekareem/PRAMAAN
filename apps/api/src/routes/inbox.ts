import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, can, h, requirePermission, type AuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import {
  assignmentScopeSql,
  flagScopeSql,
  officerInScope,
  officerScopeSql,
  restrictedSessionFilterSql,
} from '../security/access.js';
import { appendAudit } from '../services/audit.js';
import { DUTY_CATEGORIES } from '../services/duties.js';
import { evaluateDutyExceptions } from '../services/exceptions.js';
import { isoQuery, param, uuidParam } from './common.js';

/** In-app notifications. Fetching them is what marks them DELIVERED (truthful delivery state). */
export function notificationRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    h(async (req, res) => {
      const u = authUser(req);
      const q = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(req.query);
      const { rows } = await ctx.pool.query(
        `UPDATE notifications SET delivery_status = 'DELIVERED', delivered_at = now()
          WHERE id IN (SELECT id FROM notifications WHERE recipient_user_id = $1 ORDER BY created_at DESC LIMIT $2) AND delivery_status = 'QUEUED'
          RETURNING id`,
        [u.id, q.limit],
      );
      const items = await ctx.pool.query(
        `SELECT id, kind, title, body, related_type AS "relatedType", related_id AS "relatedId", delivery_status AS "deliveryStatus",
            created_at AS "createdAt", delivered_at AS "deliveredAt", read_at AS "readAt"
           FROM notifications WHERE recipient_user_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [u.id, q.limit],
      );
      const unread = await ctx.pool.query<{ n: number }>(
        "SELECT count(*)::int n FROM notifications WHERE recipient_user_id = $1 AND delivery_status <> 'READ'",
        [u.id],
      );
      res.json({ items: items.rows, unread: unread.rows[0]!.n, newlyDelivered: rows.length });
    }),
  );
  r.post(
    '/:id/read',
    h(async (req, res) => {
      const u = authUser(req);
      const r0 = await ctx.pool.query(
        `UPDATE notifications SET delivery_status = 'READ', read_at = COALESCE(read_at, now()), delivered_at = COALESCE(delivered_at, now())
          WHERE id = $1 AND recipient_user_id = $2`,
        [param(req, 'id'), u.id],
      );
      if (!r0.rowCount) throw new AppError(404, 'NOT_FOUND', 'Notification not found.');
      res.json({ ok: true });
    }),
  );
  r.post(
    '/read-all',
    h(async (req, res) => {
      const u = authUser(req);
      await ctx.pool.query(
        `UPDATE notifications SET delivery_status = 'READ', read_at = COALESCE(read_at, now()), delivered_at = COALESCE(delivered_at, now())
          WHERE recipient_user_id = $1 AND delivery_status <> 'READ'`,
        [u.id],
      );
      res.json({ ok: true });
    }),
  );
  return r;
}

/** Exception detail, investigation notes and on-demand evaluation. */
export function exceptionRoutes(ctx: AppContext): Router {
  const r = Router();
  async function assertFlagInScope(u: AuthUser, id: string): Promise<void> {
    const args: unknown[] = [id];
    const ok = await ctx.pool.query(`SELECT 1 FROM review_flags f WHERE f.id = $1 AND ${flagScopeSql(u, args)}`, args);
    if (!ok.rowCount) throw new AppError(404, 'NOT_FOUND', 'Exception not found.');
  }

  r.get(
    '/:id',
    requirePermission('exception.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertFlagInScope(u, id);
      const flag = (
        await ctx.pool.query(
          `SELECT f.id, f.flag_type AS "flagType", f.severity, f.status, f.title, f.description, f.inputs, f.officer_id AS "officerId",
              o.display_name AS "officerName", f.duty_assignment_id AS "dutyAssignmentId", a.reference_code AS "dutyReference",
              a.category AS "dutyCategory", f.evidence_id AS "evidenceId", f.device_id AS "deviceId", f.created_at AS "createdAt",
              f.acknowledged_at AS "acknowledgedAt", f.resolved_at AS "resolvedAt", f.resolution_note AS "resolutionNote",
              au.display_name AS "assignedToName"
             FROM review_flags f LEFT JOIN officers o ON o.id = f.officer_id LEFT JOIN duty_assignments a ON a.id = f.duty_assignment_id
             LEFT JOIN app_users au ON au.id = f.assigned_to WHERE f.id = $1`,
          [id],
        )
      ).rows[0];
      const notes = await ctx.pool.query(
        `SELECT n.id, n.note, n.created_at AS "createdAt", u.display_name AS "authorName", u.role AS "authorRole"
           FROM review_flag_notes n JOIN app_users u ON u.id = n.author_user_id WHERE n.flag_id = $1 ORDER BY n.created_at`,
        [id],
      );
      const history = await ctx.pool.query(
        `SELECT a.sequence, a.occurred_at AS "occurredAt", a.action, u.display_name AS "actorName", a.details
           FROM audit_events a LEFT JOIN app_users u ON u.id = a.actor_user_id
          WHERE a.target_type = 'review_flag' AND a.target_id = $1 ORDER BY a.sequence`,
        [id],
      );
      res.json({ ...flag, notes: notes.rows, history: history.rows });
    }),
  );

  r.post(
    '/:id/notes',
    requirePermission('exception.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertFlagInScope(u, id);
      const { note } = z.object({ note: z.string().trim().min(3).max(2000) }).strict().parse(req.body);
      const nid = randomUUID();
      await withTransaction(ctx.pool, async (c) => {
        await c.query('INSERT INTO review_flag_notes (id, flag_id, author_user_id, note) VALUES ($1,$2,$3,$4)', [nid, id, u.id, note]);
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'FLAG_NOTE_ADDED',
          targetType: 'review_flag',
          targetId: id,
          requestId: reqId(req),
          details: { noteId: nid, length: note.length },
        });
      });
      res.status(201).json({ id: nid });
    }),
  );

  r.post(
    '/evaluate',
    requirePermission('exception.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const result = await evaluateDutyExceptions(ctx.pool, ctx.bus);
      await withTransaction(ctx.pool, (c) =>
        appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'EXCEPTIONS_EVALUATED',
          targetType: 'review_flags',
          requestId: reqId(req),
          details: { ...result },
        }),
      );
      res.json(result);
    }),
  );
  return r;
}

const opsQuery = z.object({
  from: isoQuery.optional(),
  to: isoQuery.optional(),
  category: z.enum(DUTY_CATEGORIES).optional(),
  unitId: uuidParam.optional(),
  officerId: uuidParam.optional(),
});

/**
 * Operational overview computed from database rows within the user's scope and filters.
 * Nothing here is hard-coded; every number is a COUNT over stored records.
 */
export function operationsRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/operations',
    requirePermission('dashboard.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = opsQuery.parse(req.query);
      const from = q.from ? new Date(q.from) : new Date(Date.now() - 7 * 86_400_000);
      const to = q.to ? new Date(q.to) : new Date(Date.now() + 7 * 86_400_000);
      const args: unknown[] = [from, to];
      const aw = [assignmentScopeSql(u, 'a', args), 'tstzrange(a.planned_start, a.planned_end) && tstzrange($1, $2)'];
      if (q.category) aw.push(`a.category = $${args.push(q.category)}`);
      if (q.unitId) aw.push(`(a.unit_id = $${args.push(q.unitId)} OR a.station_unit_id = $${args.length})`);
      if (q.officerId)
        aw.push(`EXISTS (SELECT 1 FROM duty_assignment_personnel op WHERE op.assignment_id = a.id AND op.officer_id = $${args.push(q.officerId)})`);
      const A = `FROM duty_assignments a WHERE ${aw.join(' AND ')}`;
      const byCategory = (
        await ctx.pool.query(
          `SELECT a.category, count(*)::int AS total,
              count(*) FILTER (WHERE a.status = 'COMPLETED')::int AS completed,
              count(*) FILTER (WHERE a.status = 'CANCELLED')::int AS cancelled,
              count(*) FILTER (WHERE a.status IN ('IN_PROGRESS'))::int AS "inProgress",
              count(*) FILTER (WHERE a.status IN ('ASSIGNED','ACCEPTED'))::int AS assigned,
              count(*) FILTER (WHERE a.status = 'DRAFT')::int AS draft,
              count(*) FILTER (WHERE a.status = 'EXCEPTION_REPORTED')::int AS "exceptionReported"
            ${A} GROUP BY a.category`,
          args,
        )
      ).rows;
      const sessionsSub = `SELECT p.duty_session_id FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id WHERE ${aw.join(' AND ')}`;
      const presence = (
        await ctx.pool.query(
          `SELECT count(*) FILTER (WHERE k.status IN ('ACKNOWLEDGED'))::int AS acknowledged,
                  count(*) FILTER (WHERE k.status = 'ACKNOWLEDGED_LATE')::int AS late,
                  count(*) FILTER (WHERE k.status = 'MISSED')::int AS missed
             FROM checkins k WHERE k.duty_session_id IN (${sessionsSub})`,
          args,
        )
      ).rows[0];
      const fArgs: unknown[] = [];
      const fScope = flagScopeSql(u, fArgs);
      const exceptions = (
        await ctx.pool.query(
          `SELECT f.flag_type AS "flagType", count(*)::int AS n FROM review_flags f
            WHERE f.status IN ('OPEN','ACKNOWLEDGED','ASSIGNED') AND ${fScope} GROUP BY f.flag_type ORDER BY n DESC`,
          fArgs,
        )
      ).rows;
      const eArgs: unknown[] = [];
      const ev = (
        await ctx.pool.query(
          `SELECT count(*) FILTER (WHERE e.status = 'VERIFIED')::int AS verified,
                  count(*) FILTER (WHERE e.status = 'AWAITING_UPLOAD')::int AS "awaitingUpload",
                  count(*) FILTER (WHERE e.status = 'QUARANTINED')::int AS failed
             FROM evidence_objects e WHERE ${officerScopeSql(u, 'e.officer_id', eArgs)} AND ${restrictedSessionFilterSql(u, 'e.duty_session_id', 'e.officer_id', eArgs)}`,
          eArgs,
        )
      ).rows[0];
      const sArgs: unknown[] = [];
      const syncRow = (
        await ctx.pool.query(
          `SELECT (SELECT count(*)::int FROM review_flags f WHERE f.flag_type = 'SYNC_FAILURE' AND f.status IN ('OPEN','ACKNOWLEDGED','ASSIGNED') AND ${officerScopeSql(u, 'f.officer_id', sArgs)}) AS "openSyncFailures",
                  (SELECT count(*)::int FROM ingestion_rejections ir JOIN devices dv ON dv.id = ir.device_id WHERE ir.received_at > now() - interval '24 hours' AND ${officerScopeSql(u, 'dv.officer_id', sArgs)}) AS "rejectedEvents24h",
                  (SELECT max(b.received_at) FROM sync_batches b JOIN devices dv ON dv.id = b.device_id WHERE ${officerScopeSql(u, 'dv.officer_id', sArgs)}) AS "lastBatchReceivedAt"`,
          sArgs,
        )
      ).rows[0];
      const pArgs: unknown[] = [];
      const personnel = (
        await ctx.pool.query(
          `SELECT CASE WHEN o.personnel_category = 'HOME_GUARD' THEN 'HG'
                       WHEN o.rank = 'PC' AND o.constable_category IS NOT NULL THEN 'PC_' || o.constable_category ELSE o.rank END AS cls,
                  count(*) FILTER (WHERE o.is_active)::int AS active, count(*) FILTER (WHERE NOT o.is_active)::int AS inactive
             FROM officers o WHERE ${officerScopeSql(u, 'o.id', pArgs)} GROUP BY 1 ORDER BY 1`,
          pArgs,
        )
      ).rows;
      const cArgs = [...args];
      const conflicts = (
        await ctx.pool.query(
          `SELECT count(DISTINCT a.id)::int AS n ${A} AND EXISTS (SELECT 1 FROM review_flags f WHERE f.duty_assignment_id = a.id
              AND f.flag_type IN ('ASSIGNMENT_CONFLICT','INACTIVE_PERSONNEL_ASSIGNED') AND f.status IN ('OPEN','ACKNOWLEDGED','ASSIGNED'))`,
          cArgs,
        )
      ).rows[0] as { n: number };
      let recentAudit: unknown[] = [];
      if (can(u, 'audit.view')) {
        const { auditScopeSql } = await import('./audit.js');
        const auArgs: unknown[] = [];
        recentAudit = (
          await ctx.pool.query(
            `SELECT a.sequence, a.occurred_at AS "occurredAt", a.action, a.target_type AS "targetType", u.display_name AS "actorName"
               FROM audit_events a LEFT JOIN app_users u ON u.id = a.actor_user_id WHERE ${auditScopeSql(u, auArgs)}
              ORDER BY a.sequence DESC LIMIT 8`,
            auArgs,
          )
        ).rows;
      }
      res.json({
        generatedAt: new Date().toISOString(),
        range: { from: from.toISOString(), to: to.toISOString() },
        scope: { level: u.scope.level },
        personnel,
        dutiesByCategory: byCategory,
        presence,
        evidence: ev,
        synchronisation: syncRow,
        openExceptionsByType: exceptions,
        assignmentsWithConflicts: conflicts.n,
        recentAudit,
      });
    }),
  );
  return r;
}

/** Personal summary for every signed-in user linked to a personnel record. */
export function meRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/summary',
    h(async (req, res) => {
      const u = authUser(req);
      if (!u.officerId) {
        res.json({ personnel: null, duties: [], pendingAcknowledgements: 0, devices: [], checkins: null, evidence: null });
        return;
      }
      const oid = u.officerId;
      const [profile, duties, pending, devices, checkins, evidence, handovers] = await Promise.all([
        ctx.pool.query(
          `SELECT o.id, o.employee_ref AS "personnelRef", o.display_name AS "displayName", o.personnel_category AS "personnelCategory", o.rank,
              o.constable_category AS "constableCategory", un.name AS "unitName" FROM officers o LEFT JOIN units un ON un.id = o.unit_id WHERE o.id = $1`,
          [oid],
        ),
        ctx.pool.query(
          `SELECT a.id, a.reference_code AS "referenceCode", a.category, c.label AS "categoryLabel", a.title, a.status,
              a.planned_start AS "plannedStart", a.planned_end AS "plannedEnd", a.reporting_location AS "reportingLocation",
              p.status AS "personnelStatus", a.accept_required AS "acceptRequired", s.status AS "sessionStatus",
              (SELECT i.version FROM duty_instructions i WHERE i.assignment_id = a.id ORDER BY i.version DESC LIMIT 1) AS "instructionsVersion",
              (SELECT NOT EXISTS (SELECT 1 FROM duty_instruction_acks k WHERE k.instruction_id = i.id AND k.officer_id = $1)
                 FROM duty_instructions i WHERE i.assignment_id = a.id ORDER BY i.version DESC LIMIT 1) AS "instructionsUnacknowledged"
             FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id JOIN duty_categories c ON c.code = a.category
             LEFT JOIN duty_sessions s ON s.id = p.duty_session_id
            WHERE p.officer_id = $1 AND p.status IN ('ASSIGNED','ACCEPTED') AND a.status NOT IN ('DRAFT','CANCELLED')
              AND a.planned_end > now() - interval '2 days'
            ORDER BY a.planned_start LIMIT 20`,
          [oid],
        ),
        ctx.pool.query<{ n: number }>(
          `SELECT count(*)::int n FROM duty_assignment_personnel p JOIN duty_instructions i ON i.assignment_id = p.assignment_id
             JOIN duty_assignments a ON a.id = p.assignment_id
            WHERE p.officer_id = $1 AND p.status IN ('ASSIGNED','ACCEPTED') AND a.status NOT IN ('DRAFT','CANCELLED','COMPLETED')
              AND i.version = (SELECT max(version) FROM duty_instructions WHERE assignment_id = i.assignment_id)
              AND NOT EXISTS (SELECT 1 FROM duty_instruction_acks k WHERE k.instruction_id = i.id AND k.officer_id = $1)`,
          [oid],
        ),
        ctx.pool.query(
          `SELECT d.id, d.label, d.status, d.last_seen_at AS "lastSyncAt", h.last_sequence AS "lastSequence"
             FROM devices d LEFT JOIN device_chain_heads h ON h.device_id = d.id WHERE d.officer_id = $1 ORDER BY d.registered_at DESC`,
          [oid],
        ),
        ctx.pool.query(
          `SELECT count(*) FILTER (WHERE status = 'ACKNOWLEDGED')::int AS acknowledged, count(*) FILTER (WHERE status = 'ACKNOWLEDGED_LATE')::int AS late,
                  count(*) FILTER (WHERE status = 'MISSED')::int AS missed FROM checkins WHERE officer_id = $1`,
          [oid],
        ),
        ctx.pool.query(
          `SELECT count(*) FILTER (WHERE status = 'VERIFIED')::int AS verified, count(*) FILTER (WHERE status = 'AWAITING_UPLOAD')::int AS "awaitingUpload",
                  count(*) FILTER (WHERE status = 'QUARANTINED')::int AS failed FROM evidence_objects WHERE officer_id = $1`,
          [oid],
        ),
        ctx.pool.query(
          `SELECT h.id, h.assignment_id AS "assignmentId", a.reference_code AS "dutyReference", h.handover_at AS "handoverAt",
              CASE WHEN h.outgoing_officer_id = $1 THEN 'OUTGOING' ELSE 'INCOMING' END AS side,
              (CASE WHEN h.outgoing_officer_id = $1 THEN h.outgoing_ack_at ELSE h.incoming_ack_at END) AS "acknowledgedAt"
             FROM duty_handovers h JOIN duty_assignments a ON a.id = h.assignment_id
            WHERE (h.outgoing_officer_id = $1 OR h.incoming_officer_id = $1) ORDER BY h.handover_at DESC LIMIT 10`,
          [oid],
        ),
      ]);
      res.json({
        personnel: profile.rows[0] ?? null,
        duties: duties.rows,
        pendingAcknowledgements: pending.rows[0]!.n,
        devices: devices.rows,
        checkins: checkins.rows[0],
        evidence: evidence.rows[0],
        handovers: handovers.rows,
        note: 'Server-side view. Events still queued on a device appear only after it synchronises.',
      });
    }),
  );
  return r;
}

export { officerInScope };
