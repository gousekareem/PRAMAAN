import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, h, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import { appendAudit } from '../services/audit.js';
import {
  assertOfficerScope,
  isoQuery,
  pageQuery,
  pageResult,
  paging,
  param,
  uuidParam,
} from './common.js';

const filters = z.object({
  officerId: uuidParam.optional(),
  dutySessionId: uuidParam.optional(),
  eventType: z
    .string()
    .regex(/^[A-Z_]{3,40}$/)
    .optional(),
  spatialResult: z
    .enum([
      'INSIDE_ASSIGNED_ZONE',
      'OUTSIDE_WITHIN_ACCURACY',
      'OUTSIDE_ASSIGNED_ZONE',
      'NO_ASSIGNED_ZONE',
      'NO_LOCATION',
    ])
    .optional(),
  from: isoQuery.optional(),
  to: isoQuery.optional(),
});

const cols = `p.id, p.event_id AS "eventId", p.officer_id AS "officerId", o.display_name AS "officerName", p.duty_session_id AS "dutySessionId",
  p.device_id AS "deviceId", p.event_type AS "eventType", ST_Y(p.location::geometry) AS latitude, ST_X(p.location::geometry) AS longitude,
  p.horizontal_accuracy_m AS "horizontalAccuracyM", p.recorded_device_time AS "recordedDeviceTime", p.trusted_time_estimate AS "trustedTimeEstimate",
  p.server_received_at AS "serverReceivedAt", p.evidence_id AS "evidenceId", p.verification_status AS "verificationStatus",
  p.spatial_result AS "spatialResult", p.matched_zone_ids AS "matchedZoneIds", p.distance_to_assigned_zone_m AS "distanceToAssignedZoneM",
  p.mock_indicator AS "mockIndicator", o.is_demo AS "isDemo"`;

function buildWhere(u: ReturnType<typeof authUser>, f: z.infer<typeof filters>) {
  const where: string[] = [];
  const args: unknown[] = [];
  const push = (sql: string, v: unknown) => {
    args.push(v);
    where.push(sql.replace('?', `$${args.length}`));
  };
  if (u.role === 'OFFICER') push('p.officer_id = ?', u.officerId);
  else if (f.officerId) push('p.officer_id = ?', f.officerId);
  if (f.dutySessionId) push('p.duty_session_id = ?', f.dutySessionId);
  if (f.eventType) push('p.event_type = ?', f.eventType);
  if (f.spatialResult) push('p.spatial_result = ?', f.spatialResult);
  if (f.from) push('p.recorded_device_time >= ?', new Date(f.from));
  if (f.to) push('p.recorded_device_time <= ?', new Date(f.to));
  return { w: where.length ? `WHERE ${where.join(' AND ')}` : '', args };
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join(';') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // CSV formula-injection guard
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function patrolLogRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    requireRole('ADMIN', 'SUPERVISOR', 'REVIEWER', 'OFFICER'),
    h(async (req, res) => {
      const q = pageQuery.merge(filters).parse(req.query);
      const { limit, offset } = paging(q);
      const { w, args } = buildWhere(authUser(req), q);
      const total = (
        await ctx.pool.query<{ n: number }>(`SELECT count(*)::int n FROM patrol_logs p ${w}`, args)
      ).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT ${cols} FROM patrol_logs p JOIN officers o ON o.id = p.officer_id ${w} ORDER BY p.recorded_device_time DESC LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );

  r.get(
    '/export.csv',
    requireRole('ADMIN', 'SUPERVISOR'),
    h(async (req, res) => {
      const u = authUser(req);
      const f = filters.parse(req.query);
      const { w, args } = buildWhere(u, f);
      const { rows } = await ctx.pool.query<Record<string, unknown>>(
        `SELECT ${cols} FROM patrol_logs p JOIN officers o ON o.id = p.officer_id ${w} ORDER BY p.recorded_device_time LIMIT 50000`,
        args,
      );
      await withTransaction(ctx.pool, (c) =>
        appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'PATROL_LOG_EXPORTED',
          targetType: 'patrol_logs',
          requestId: reqId(req),
          details: { filters: f, rows: rows.length, format: 'csv' },
        }),
      );
      const headers = [
        'eventId',
        'officerName',
        'eventType',
        'recordedDeviceTime',
        'trustedTimeEstimate',
        'serverReceivedAt',
        'latitude',
        'longitude',
        'horizontalAccuracyM',
        'spatialResult',
        'distanceToAssignedZoneM',
        'mockIndicator',
        'verificationStatus',
        'evidenceId',
        'isDemo',
      ];
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="pramaan-patrol-logs.csv"');
      res.send(
        [headers.join(','), ...rows.map((r) => headers.map((hh) => csvCell(r[hh])).join(','))].join(
          '\r\n',
        ) + '\r\n',
      );
    }),
  );

  r.get(
    '/:id',
    requireRole('ADMIN', 'SUPERVISOR', 'REVIEWER', 'OFFICER'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const row = (
        await ctx.pool.query<{ officerId: string }>(
          `SELECT ${cols}, d.envelope FROM patrol_logs p JOIN officers o ON o.id = p.officer_id JOIN device_events d ON d.event_id = p.event_id WHERE p.id = $1`,
          [id],
        )
      ).rows[0];
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Patrol log not found.');
      assertOfficerScope(authUser(req), row.officerId);
      res.json(row);
    }),
  );
  return r;
}
