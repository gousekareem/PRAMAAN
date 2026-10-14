import { randomUUID } from 'node:crypto';
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

const createSchema = z
  .object({
    officerId: uuidParam,
    plannedStart: isoQuery,
    plannedEnd: isoQuery,
    zoneIds: z.array(uuidParam).min(1).max(20),
    notes: z.string().max(500).optional(),
  })
  .strict();

const cols = `s.id, s.officer_id AS "officerId", o.display_name AS "officerName", s.device_id AS "deviceId", s.planned_start AS "plannedStart",
  s.planned_end AS "plannedEnd", s.status, s.device_started_at AS "deviceStartedAt", s.device_ended_at AS "deviceEndedAt",
  s.assignment_notes AS "notes", s.is_demo AS "isDemo", s.created_at AS "createdAt",
  COALESCE((SELECT json_agg(json_build_object('id', z.id, 'code', z.code, 'name', z.name)) FROM duty_zone_assignments a JOIN geo_zones z ON z.id = a.zone_id WHERE a.duty_session_id = s.id), '[]') AS zones`;

export function dutyRoutes(ctx: AppContext): Router {
  const r = Router();

  r.get(
    '/',
    requireRole('ADMIN', 'SUPERVISOR', 'REVIEWER', 'OFFICER'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = pageQuery
        .extend({
          status: z.enum(['PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED']).optional(),
          officerId: uuidParam.optional(),
        })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const where: string[] = [];
      const args: unknown[] = [];
      const officerId = u.role === 'OFFICER' ? u.officerId : q.officerId;
      if (officerId) {
        args.push(officerId);
        where.push(`s.officer_id = $${args.length}`);
      }
      if (q.status) {
        args.push(q.status);
        where.push(`s.status = $${args.length}`);
      }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (
        await ctx.pool.query<{ n: number }>(
          `SELECT count(*)::int n FROM duty_sessions s ${w}`,
          args,
        )
      ).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT ${cols} FROM duty_sessions s JOIN officers o ON o.id = s.officer_id ${w} ORDER BY s.planned_start DESC LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );

  r.get(
    '/:id',
    requireRole('ADMIN', 'SUPERVISOR', 'REVIEWER', 'OFFICER'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const row = (
        await ctx.pool.query<{ officerId: string }>(
          `SELECT ${cols} FROM duty_sessions s JOIN officers o ON o.id = s.officer_id WHERE s.id = $1`,
          [id],
        )
      ).rows[0];
      if (!row) throw new AppError(404, 'NOT_FOUND', 'Duty session not found.');
      assertOfficerScope(authUser(req), row.officerId);
      res.json(row);
    }),
  );

  r.post(
    '/',
    requireRole('ADMIN', 'SUPERVISOR'),
    h(async (req, res) => {
      const u = authUser(req);
      const b = createSchema.parse(req.body);
      const start = new Date(b.plannedStart);
      const end = new Date(b.plannedEnd);
      if (end <= start)
        throw new AppError(400, 'VALIDATION_FAILED', 'plannedEnd must be after plannedStart.');
      if (end.getTime() - start.getTime() > 16 * 3600_000)
        throw new AppError(400, 'VALIDATION_FAILED', 'A duty session may not exceed 16 hours.');
      const id = randomUUID();
      await withTransaction(ctx.pool, async (c) => {
        const o = (
          await c.query<{ is_active: boolean }>('SELECT is_active FROM officers WHERE id = $1', [
            b.officerId,
          ])
        ).rows[0];
        if (!o?.is_active)
          throw new AppError(400, 'VALIDATION_FAILED', 'Officer not found or inactive.');
        const zones = await c.query(
          'SELECT id FROM geo_zones WHERE id = ANY($1::uuid[]) AND is_active',
          [b.zoneIds],
        );
        if (zones.rowCount !== new Set(b.zoneIds).size)
          throw new AppError(
            400,
            'VALIDATION_FAILED',
            'One or more zones are unknown or inactive.',
          );
        const overlap = await c.query(
          `SELECT 1 FROM duty_sessions WHERE officer_id = $1 AND status IN ('PLANNED','ACTIVE') AND tstzrange(planned_start, planned_end) && tstzrange($2, $3)`,
          [b.officerId, start, end],
        );
        if (overlap.rowCount)
          throw new AppError(
            409,
            'CONFLICT',
            'Officer already has an overlapping planned or active duty session.',
          );
        await c.query(
          'INSERT INTO duty_sessions (id, officer_id, planned_start, planned_end, assignment_notes, authorized_by) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, b.officerId, start, end, b.notes ?? null, u.id],
        );
        for (const z of new Set(b.zoneIds))
          await c.query(
            'INSERT INTO duty_zone_assignments (duty_session_id, zone_id) VALUES ($1,$2)',
            [id, z],
          );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'DUTY_CREATED',
          targetType: 'duty_session',
          targetId: id,
          requestId: reqId(req),
          details: {
            officerId: b.officerId,
            plannedStart: start.toISOString(),
            plannedEnd: end.toISOString(),
            zoneIds: b.zoneIds,
          },
        });
      });
      res
        .status(201)
        .json(
          (
            await ctx.pool.query(
              `SELECT ${cols} FROM duty_sessions s JOIN officers o ON o.id = s.officer_id WHERE s.id = $1`,
              [id],
            )
          ).rows[0],
        );
    }),
  );

  r.post(
    '/:id/cancel',
    requireRole('ADMIN', 'SUPERVISOR'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      const { reason } = z
        .object({ reason: z.string().min(3).max(200) })
        .strict()
        .parse(req.body);
      await withTransaction(ctx.pool, async (c) => {
        const d = (
          await c.query<{ status: string }>(
            'SELECT status FROM duty_sessions WHERE id = $1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!d) throw new AppError(404, 'NOT_FOUND', 'Duty session not found.');
        if (d.status !== 'PLANNED')
          throw new AppError(
            409,
            'CONFLICT',
            'Only PLANNED sessions can be cancelled; active sessions end from the device.',
          );
        await c.query("UPDATE duty_sessions SET status = 'CANCELLED' WHERE id = $1", [id]);
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'DUTY_CANCELLED',
          targetType: 'duty_session',
          targetId: id,
          requestId: reqId(req),
          details: { reason },
        });
      });
      res.json({ id, status: 'CANCELLED' });
    }),
  );
  return r;
}
