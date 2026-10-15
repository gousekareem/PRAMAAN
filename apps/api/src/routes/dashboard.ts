import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, h, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { flagScopeSql, officerScopeSql, restrictedSessionFilterSql } from '../security/access.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import { appendAudit } from '../services/audit.js';
import { freshness, pageQuery, pageResult, paging, param, uuidParam } from './common.js';

const FLAG_TYPES = [
  'CHECKIN_MISSED',
  'CHECKIN_LATE',
  'CLOCK_ANOMALY',
  'MOCK_LOCATION_INDICATOR',
  'EVIDENCE_HASH_MISMATCH',
  'INVALID_DEVICE_SIGNATURE',
  'SEQUENCE_GAP',
  'CHAIN_LINK_MISMATCH',
  'EVENT_CONFLICT',
  'SPATIAL_ZONE_EXCEPTION',
  'MOVEMENT_INCONSISTENCY',
  'DEVICE_REGISTRATION',
  'DEVICE_REVOCATION',
  'DEVICE_INTEGRITY',
  'SCREEN_RECAPTURE_RISK',
  'DUTY_REPORTING_DELAYED',
  'DUTY_OVERDUE',
  'SYNC_FAILURE',
  'ASSIGNMENT_CONFLICT',
  'INACTIVE_PERSONNEL_ASSIGNED',
  'DUTY_EXCEPTION_REPORTED',
] as const;

export function dashboardRoutes(ctx: AppContext): Router {
  const r = Router();
  const viewers = requireAnyPermission('dashboard.view', 'exception.view');

  r.get(
    '/summary',
    requirePermission('dashboard.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const a: unknown[] = [];
      const sc = (col: string) => officerScopeSql(u, col, a);
      const { rows } = await ctx.pool.query(
        `SELECT
      (SELECT count(*)::int FROM duty_sessions WHERE status = 'ACTIVE' AND ${sc('officer_id')}) AS "activeDutySessions",
      (SELECT count(*)::int FROM devices WHERE status = 'ACTIVE' AND last_seen_at > now() - interval '30 minutes' AND ${sc('officer_id')}) AS "devicesSeen30m",
      (SELECT count(*)::int FROM devices WHERE status = 'ACTIVE' AND ${sc('officer_id')}) AS "activeDevices",
      (SELECT count(*)::int FROM devices WHERE status = 'PENDING' AND ${sc('officer_id')}) AS "pendingDevices",
      (SELECT count(*)::int FROM evidence_objects WHERE status = 'AWAITING_UPLOAD' AND ${sc('officer_id')}) AS "evidenceAwaitingUpload",
      (SELECT count(*)::int FROM checkins WHERE status = 'MISSED' AND updated_at > now() - interval '24 hours' AND ${sc('officer_id')}) AS "missedCheckins24h",
      (SELECT count(*)::int FROM review_flags WHERE status IN ('OPEN','ACKNOWLEDGED','ASSIGNED') AND ${sc('officer_id')}) AS "openFlags",
      (SELECT count(*)::int FROM review_flags WHERE status IN ('OPEN','ACKNOWLEDGED','ASSIGNED') AND evidence_id IS NOT NULL AND ${sc('officer_id')}) AS "evidenceRequiringReview",
      (SELECT count(*)::int FROM review_flags WHERE flag_type = 'SPATIAL_ZONE_EXCEPTION' AND status IN ('OPEN','ACKNOWLEDGED','ASSIGNED') AND ${sc('officer_id')}) AS "spatialExceptions",
      (SELECT max(b.received_at) FROM sync_batches b JOIN devices dv ON dv.id = b.device_id WHERE ${sc('dv.officer_id')}) AS "lastBatchReceivedAt"`,
        a,
      );
      const db = await ctx.pool
        .query('SELECT postgis_lib_version() AS v')
        .then(() => 'ok')
        .catch(() => 'unavailable');
      res.json({
        ...rows[0],
        systemHealth: { api: 'ok', database: db },
        generatedAt: new Date().toISOString(),
      });
    }),
  );

  /** Last known observation per officer, with explicit freshness labels (never called "live"). */
  r.get(
    '/observations',
    requirePermission('map.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = z
        .object({
          dutySessionId: uuidParam.optional(),
          zoneId: uuidParam.optional(),
          sinceHours: z.coerce.number().min(1).max(168).default(24),
        })
        .parse(req.query);
      const args: unknown[] = [q.sinceHours];
      let extra = ` AND ${officerScopeSql(u, 'p.officer_id', args)} AND ${restrictedSessionFilterSql(u, 'p.duty_session_id', 'p.officer_id', args)}`;
      if (q.dutySessionId) {
        args.push(q.dutySessionId);
        extra += ` AND p.duty_session_id = $${args.length}`;
      }
      if (q.zoneId) {
        args.push(q.zoneId);
        extra += ` AND $${args.length}::uuid = ANY(p.matched_zone_ids)`;
      }
      const { rows } = await ctx.pool.query<
        Record<string, unknown> & { recordedDeviceTime: Date; serverReceivedAt: Date }
      >(
        `SELECT DISTINCT ON (p.officer_id) p.officer_id AS "officerId", o.display_name AS "officerName", o.is_demo AS "isDemo", p.event_id AS "eventId",
              p.event_type AS "eventType", ST_Y(p.location::geometry) AS latitude, ST_X(p.location::geometry) AS longitude,
              p.horizontal_accuracy_m AS "horizontalAccuracyM", p.recorded_device_time AS "recordedDeviceTime", p.trusted_time_estimate AS "trustedTimeEstimate",
              p.server_received_at AS "serverReceivedAt", p.spatial_result AS "spatialResult", p.mock_indicator AS "mockIndicator",
              p.duty_session_id AS "dutySessionId", p.verification_status AS "verificationStatus"
         FROM patrol_logs p JOIN officers o ON o.id = p.officer_id
        WHERE p.location IS NOT NULL AND p.recorded_device_time > now() - make_interval(hours => $1::int) ${extra}
        ORDER BY p.officer_id, p.recorded_device_time DESC`,
        args,
      );
      const now = new Date();
      res.json({
        generatedAt: now.toISOString(),
        items: rows.map((r) => ({
          ...r,
          freshness: freshness(new Date(r.recordedDeviceTime), new Date(r.serverReceivedAt), now),
        })),
      });
    }),
  );

  r.get(
    '/alerts',
    requirePermission('exception.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = pageQuery
        .extend({
          status: z
            .enum(['OPEN', 'ACKNOWLEDGED', 'ASSIGNED', 'RESOLVED', 'DISMISSED', 'ACTIVE'])
            .default('ACTIVE'),
          type: z.enum(FLAG_TYPES).optional(),
          severity: z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH']).optional(),
          officerId: uuidParam.optional(),
          assignmentId: uuidParam.optional(),
          category: z.enum(['TRAIN_BEAT', 'STATION_WATCH', 'VIP_ESCORT', 'TRACK_INCIDENT']).optional(),
        })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      const where: string[] = [flagScopeSql(u, args)];
      if (q.assignmentId) {
        args.push(q.assignmentId);
        where.push(`f.duty_assignment_id = $${args.length}`);
      }
      if (q.category) {
        args.push(q.category);
        where.push(`fa.category = $${args.length}`);
      }
      if (q.status === 'ACTIVE') where.push("f.status IN ('OPEN','ACKNOWLEDGED','ASSIGNED')");
      else {
        args.push(q.status);
        where.push(`f.status = $${args.length}`);
      }
      if (q.type) {
        args.push(q.type);
        where.push(`f.flag_type = $${args.length}`);
      }
      if (q.severity) {
        args.push(q.severity);
        where.push(`f.severity = $${args.length}`);
      }
      if (q.officerId) {
        args.push(q.officerId);
        where.push(`f.officer_id = $${args.length}`);
      }
      const w = `WHERE ${where.join(' AND ')}`;
      const total = (
        await ctx.pool.query<{ n: number }>(
          `SELECT count(*)::int n FROM review_flags f LEFT JOIN duty_assignments fa ON fa.id = f.duty_assignment_id ${w}`,
          args,
        )
      ).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT f.id, f.flag_type AS "flagType", f.severity, f.status, f.title, f.description, f.officer_id AS "officerId", o.display_name AS "officerName",
              f.device_id AS "deviceId", f.duty_session_id AS "dutySessionId", f.event_id AS "eventId", f.evidence_id AS "evidenceId", f.inputs,
              f.assigned_to AS "assignedTo", au.display_name AS "assignedToName", f.acknowledged_at AS "acknowledgedAt", f.resolved_at AS "resolvedAt",
              f.resolution_note AS "resolutionNote", f.created_at AS "createdAt", f.updated_at AS "updatedAt", o.is_demo AS "isDemo",
              f.duty_assignment_id AS "dutyAssignmentId", fa.reference_code AS "dutyReference", fa.category AS "dutyCategory",
              (SELECT count(*)::int FROM review_flag_notes n WHERE n.flag_id = f.id) AS "noteCount"
         FROM review_flags f LEFT JOIN officers o ON o.id = f.officer_id LEFT JOIN app_users au ON au.id = f.assigned_to
         LEFT JOIN duty_assignments fa ON fa.id = f.duty_assignment_id ${w}
        ORDER BY CASE f.severity WHEN 'HIGH' THEN 0 WHEN 'MEDIUM' THEN 1 WHEN 'LOW' THEN 2 ELSE 3 END, f.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );

  /** Server-Sent Events. Uses a Bearer token sent via fetch() streaming (EventSource cannot set headers). */
  r.get('/stream', viewers, (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString() })}\n\n`);
    const unsub = ctx.bus.subscribe((e) =>
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`),
    );
    const hb = setInterval(() => res.write(': heartbeat\n\n'), 25_000);
    const maxLife = setTimeout(() => res.end(), 30 * 60_000); // forces periodic re-authentication
    req.on('close', () => {
      unsub();
      clearInterval(hb);
      clearTimeout(maxLife);
    });
  });
  return r;
}

const actionSchema = z
  .object({
    action: z.enum(['ACKNOWLEDGE', 'ASSIGN', 'RESOLVE', 'DISMISS', 'REOPEN']),
    assigneeId: uuidParam.optional(),
    note: z.string().min(3).max(1000).optional(),
  })
  .strict();

/** Alert workflow. Every action is audited; the underlying observation is never modified. */
export function alertRoutes(ctx: AppContext): Router {
  const r = Router();
  r.patch(
    '/:id',
    requirePermission('exception.manage'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const u = authUser(req);
      const b = actionSchema.parse(req.body);
      if ((b.action === 'RESOLVE' || b.action === 'DISMISS') && !b.note)
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          'A note is required to resolve or dismiss a flag.',
        );
      if (b.action === 'ASSIGN' && !b.assigneeId)
        throw new AppError(400, 'VALIDATION_FAILED', 'assigneeId is required.');
      const updated = await withTransaction(ctx.pool, async (c) => {
        const f = (
          await c.query<{ status: string; officer_id: string | null }>(
            'SELECT status, officer_id FROM review_flags WHERE id = $1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!f) throw new AppError(404, 'NOT_FOUND', 'Flag not found.');
        const sArgs: unknown[] = [id];
        const visible = await c.query(`SELECT 1 FROM review_flags f WHERE f.id = $1 AND ${flagScopeSql(u, sArgs)}`, sArgs);
        if (!visible.rowCount) throw new AppError(404, 'NOT_FOUND', 'Flag not found.');
        const closed = ['RESOLVED', 'DISMISSED'].includes(f.status);
        if (b.action !== 'REOPEN' && closed)
          throw new AppError(409, 'CONFLICT', 'Flag is closed; reopen it first.');
        if (b.action === 'REOPEN' && !closed)
          throw new AppError(409, 'CONFLICT', 'Flag is not closed.');
        switch (b.action) {
          case 'ACKNOWLEDGE':
            await c.query(
              "UPDATE review_flags SET status = CASE WHEN status = 'OPEN' THEN 'ACKNOWLEDGED' ELSE status END, acknowledged_by = $2, acknowledged_at = COALESCE(acknowledged_at, now()) WHERE id = $1",
              [id, u.id],
            );
            break;
          case 'ASSIGN': {
            const a = (
              await c.query<{ is_active: boolean; can_view: boolean }>(
                `SELECT u.is_active, EXISTS (SELECT 1 FROM role_permissions rp WHERE rp.role_code = u.role AND rp.permission_code = 'exception.view') AS can_view
                   FROM app_users u WHERE u.id = $1`,
                [b.assigneeId],
              )
            ).rows[0];
            if (!a?.is_active || !a.can_view)
              throw new AppError(
                400,
                'VALIDATION_FAILED',
                'Assignee must be an active dashboard user.',
              );
            await c.query(
              "UPDATE review_flags SET status = 'ASSIGNED', assigned_to = $2 WHERE id = $1",
              [id, b.assigneeId],
            );
            break;
          }
          case 'RESOLVE':
          case 'DISMISS':
            await c.query(
              'UPDATE review_flags SET status = $2, resolved_by = $3, resolved_at = now(), resolution_note = $4 WHERE id = $1',
              [id, b.action === 'RESOLVE' ? 'RESOLVED' : 'DISMISSED', u.id, b.note],
            );
            break;
          case 'REOPEN':
            await c.query(
              "UPDATE review_flags SET status = 'OPEN', resolved_by = NULL, resolved_at = NULL WHERE id = $1",
              [id],
            );
            break;
        }
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: `FLAG_${b.action}`,
          targetType: 'review_flag',
          targetId: id,
          requestId: reqId(req),
          details: {
            previousStatus: f.status,
            note: b.note ?? null,
            assigneeId: b.assigneeId ?? null,
          },
        });
        return (
          await c.query<{ status: string }>(
            'SELECT id, status, assigned_to AS "assignedTo", resolution_note AS "resolutionNote" FROM review_flags WHERE id = $1',
            [id],
          )
        ).rows[0]!;
      });
      ctx.bus.publish({
        type: 'flag-updated',
        flagId: id,
        status: updated.status,
        at: new Date().toISOString(),
      });
      res.json(updated);
    }),
  );
  return r;
}
