import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { authUser, h, requirePermission } from '../middleware/auth.js';
import { assertOfficerInScope, officerScopeSql } from '../security/access.js';
import { AppError } from '../middleware/errors.js';

function requirePermissionSync(u: ReturnType<typeof authUser>, p: string): void {
  if (!u.permissions.has(p)) throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
}
import { pageQuery, pageResult, paging, param } from './common.js';

export function officerRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    requirePermission('personnel.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = pageQuery
        .extend({ q: z.string().max(60).optional(), active: z.enum(['true', 'false']).optional() })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      const where: string[] = [officerScopeSql(u, 'o.id', args)];
      if (q.q) {
        args.push(`%${q.q}%`);
        where.push(
          `(o.display_name ILIKE $${args.length} OR o.employee_ref ILIKE $${args.length})`,
        );
      }
      if (q.active) {
        args.push(q.active === 'true');
        where.push(`o.is_active = $${args.length}`);
      }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (
        await ctx.pool.query<{ n: number }>(`SELECT count(*)::int n FROM officers o ${w}`, args)
      ).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT o.id, o.employee_ref AS "employeeRef", o.display_name AS "displayName", o.rank, o.station, o.personnel_category AS "personnelCategory", o.constable_category AS "constableCategory", o.is_active AS "isActive", o.is_demo AS "isDemo",
              (SELECT max(d.last_seen_at) FROM devices d WHERE d.officer_id = o.id) AS "lastSyncAt",
              (SELECT count(*)::int FROM review_flags f WHERE f.officer_id = o.id AND f.status IN ('OPEN','ACKNOWLEDGED','ASSIGNED')) AS "openFlags",
              (SELECT s.id FROM duty_sessions s WHERE s.officer_id = o.id AND s.status = 'ACTIVE' ORDER BY s.planned_start DESC LIMIT 1) AS "activeDutyId"
         FROM officers o ${w} ORDER BY o.display_name LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );

  r.get(
    '/:id',
    h(async (req, res) => {
      const id = param(req, 'id');
      const u = authUser(req);
      // Own record is always readable; other records need personnel.view and must be in scope.
      if (u.officerId !== id) {
        requirePermissionSync(u, 'personnel.view');
        await assertOfficerInScope(ctx.pool, u, id);
      }
      const officer = (
        await ctx.pool.query(
          `SELECT id, employee_ref AS "employeeRef", display_name AS "displayName", rank, station, personnel_category AS "personnelCategory", constable_category AS "constableCategory", is_active AS "isActive", is_demo AS "isDemo", created_at AS "createdAt" FROM officers WHERE id = $1`,
          [id],
        )
      ).rows[0];
      if (!officer) throw new AppError(404, 'NOT_FOUND', 'Officer not found.');
      const [duty, devices, checkins, evidence, flags] = await Promise.all([
        ctx.pool.query(
          `SELECT id, planned_start AS "plannedStart", planned_end AS "plannedEnd", status, device_started_at AS "deviceStartedAt" FROM duty_sessions WHERE officer_id = $1 AND status IN ('ACTIVE','PLANNED') ORDER BY planned_start DESC LIMIT 1`,
          [id],
        ),
        ctx.pool.query(
          `SELECT id, label, status, platform, key_hardware_backed AS "keyHardwareBacked", registered_at AS "registeredAt", approved_at AS "approvedAt", revoked_at AS "revokedAt", last_seen_at AS "lastSyncAt", app_version AS "appVersion" FROM devices WHERE officer_id = $1 ORDER BY registered_at DESC`,
          [id],
        ),
        ctx.pool.query(
          `SELECT checkin_id AS "checkinId", scheduled_for AS "scheduledFor", deadline_at AS "deadlineAt", status, biometric_result AS "biometricResult", challenge_result AS "challengeResult", response_ms AS "responseMs", late_by_ms AS "lateByMs", missed_reason AS "missedReason" FROM checkins WHERE officer_id = $1 ORDER BY scheduled_for DESC NULLS LAST LIMIT 20`,
          [id],
        ),
        ctx.pool.query(
          `SELECT evidence_id AS "evidenceId", status, created_at AS "createdAt", manifest->'capture'->>'deviceWallTime' AS "capturedAtDevice" FROM evidence_objects WHERE officer_id = $1 ORDER BY created_at DESC LIMIT 20`,
          [id],
        ),
        ctx.pool.query(
          `SELECT id, flag_type AS "flagType", severity, status, title, created_at AS "createdAt" FROM review_flags WHERE officer_id = $1 ORDER BY created_at DESC LIMIT 20`,
          [id],
        ),
      ]);
      res.json({
        officer,
        currentDuty: duty.rows[0] ?? null,
        devices: devices.rows,
        checkins: checkins.rows,
        evidence: evidence.rows,
        flags: flags.rows,
      });
    }),
  );
  return r;
}
