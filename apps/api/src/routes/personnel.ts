import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, can, h, requirePermission, type AuthUser } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import { assertOfficerInScope, officerScopeSql, unitScopeSql } from '../security/access.js';
import { appendAudit } from '../services/audit.js';
import { findConflicts, personnelClass } from '../services/duties.js';
import { raiseFlag } from '../services/flags.js';
import { isoQuery, pageQuery, pageResult, paging, param, uuidParam } from './common.js';

export const RANKS = ['PC', 'HC', 'ASI', 'SI', 'CI', 'DSP', 'OTHER'] as const;

const profileFields = {
  displayName: z.string().trim().min(2).max(80),
  personnelCategory: z.enum(['POLICE', 'HOME_GUARD']),
  rank: z.enum(RANKS).nullable(),
  constableCategory: z.enum(['AR', 'GENERAL']).nullable(),
  gender: z.enum(['FEMALE', 'MALE', 'OTHER', 'NOT_RECORDED']),
  unitId: uuidParam,
};

function checkClassification(
  v: { personnelCategory?: string; rank?: string | null; constableCategory?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (v.personnelCategory === 'HOME_GUARD' && v.rank)
    ctx.addIssue({ code: 'custom', path: ['rank'], message: 'Home Guards are not placed in the police rank hierarchy.' });
  if (v.personnelCategory === 'POLICE' && v.rank === null)
    ctx.addIssue({ code: 'custom', path: ['rank'], message: 'Police personnel need a rank.' });
  if (v.constableCategory && v.rank !== 'PC')
    ctx.addIssue({ code: 'custom', path: ['constableCategory'], message: 'AR/General applies to PC only.' });
}

const createSchema = z
  .object({
    personnelRef: z.string().regex(/^[A-Z0-9-]{3,32}$/),
    ...profileFields,
    rank: profileFields.rank.optional(),
    constableCategory: profileFields.constableCategory.optional(),
    gender: profileFields.gender.default('NOT_RECORDED'),
  })
  .strict()
  .superRefine(checkClassification);

const updateSchema = z
  .object({
    displayName: profileFields.displayName.optional(),
    personnelCategory: profileFields.personnelCategory.optional(),
    rank: profileFields.rank.optional(),
    constableCategory: profileFields.constableCategory.optional(),
    gender: profileFields.gender.optional(),
    unitId: profileFields.unitId.optional(),
    reason: z.string().trim().min(5).max(300),
  })
  .strict();

const PROFILE_COLS = `o.id, o.employee_ref AS "personnelRef", o.display_name AS "displayName", o.personnel_category AS "personnelCategory",
  o.rank, o.constable_category AS "constableCategory", o.gender, o.unit_id AS "unitId", un.name AS "unitName", un.code AS "unitCode",
  o.is_active AS "isActive", o.is_demo AS "isDemo", o.created_at AS "createdAt", o.updated_at AS "updatedAt"`;

function classOf(r: { personnelCategory: string; rank: string | null; constableCategory: string | null }) {
  return personnelClass({
    personnel_category: r.personnelCategory as 'POLICE' | 'HOME_GUARD',
    rank: r.rank,
    constable_category: r.constableCategory as 'AR' | 'GENERAL' | null,
  });
}

export function personnelRoutes(ctx: AppContext): Router {
  const r = Router();

  async function assertUnitInScope(u: AuthUser, unitId: string): Promise<void> {
    const args: unknown[] = [unitId];
    const ok = await ctx.pool.query(`SELECT 1 FROM units WHERE id = $1 AND ${unitScopeSql(u, 'id', args)}`, args);
    if (!ok.rowCount) throw new AppError(403, 'FORBIDDEN', 'The unit is outside your configured scope.');
  }

  r.get(
    '/',
    requirePermission('personnel.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = pageQuery
        .extend({
          q: z.string().max(60).optional(),
          rank: z.enum(RANKS).optional(),
          personnelCategory: z.enum(['POLICE', 'HOME_GUARD']).optional(),
          constableCategory: z.enum(['AR', 'GENERAL']).optional(),
          status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
          unitId: uuidParam.optional(),
          personnelClass: z.string().regex(/^[A-Z_]{2,12}$/).optional(),
        })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      const where = [officerScopeSql(u, 'o.id', args)];
      const push = (sql: string, v: unknown) => {
        args.push(v);
        where.push(sql.replaceAll('?', `$${args.length}`));
      };
      if (q.q) push('(o.display_name ILIKE ? OR o.employee_ref ILIKE ?)', `%${q.q}%`);
      if (q.rank) push('o.rank = ?', q.rank);
      if (q.personnelCategory) push('o.personnel_category = ?', q.personnelCategory);
      if (q.constableCategory) push('o.constable_category = ?', q.constableCategory);
      if (q.status) push('o.is_active = ?', q.status === 'ACTIVE');
      if (q.unitId) push('o.unit_id = ?', q.unitId);
      if (q.personnelClass === 'HG') where.push("o.personnel_category = 'HOME_GUARD'");
      else if (q.personnelClass?.startsWith('PC_')) push("o.rank = 'PC' AND o.constable_category = ?", q.personnelClass.slice(3));
      else if (q.personnelClass) push('o.rank = ?', q.personnelClass);
      const w = `WHERE ${where.join(' AND ')}`;
      const total = (
        await ctx.pool.query<{ n: number }>(`SELECT count(*)::int n FROM officers o ${w}`, args)
      ).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT ${PROFILE_COLS},
            (SELECT au.role FROM app_users au WHERE au.officer_id = o.id) AS "accountRole",
            (SELECT count(*)::int FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id
              WHERE p.officer_id = o.id AND p.status IN ('ASSIGNED','ACCEPTED') AND a.status NOT IN ('COMPLETED','CANCELLED')) AS "openDuties",
            (SELECT max(d.last_seen_at) FROM devices d WHERE d.officer_id = o.id) AS "lastSyncAt"
           FROM officers o LEFT JOIN units un ON un.id = o.unit_id ${w}
          ORDER BY CASE WHEN o.personnel_category = 'HOME_GUARD' THEN 0 ELSE 1 END,
                   array_position(ARRAY['PC','HC','ASI','SI','CI','DSP','OTHER'], o.rank), o.display_name
          LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(
        pageResult(
          rows.map((x) => ({ ...x, personnelClass: classOf(x) })),
          total,
          q,
        ),
      );
    }),
  );

  /** Aggregates used by the personnel page and overview (scoped). */
  r.get(
    '/stats',
    requirePermission('personnel.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const args: unknown[] = [];
      const { rows } = await ctx.pool.query<{ cls: string; active: boolean; n: number }>(
        `SELECT CASE WHEN o.personnel_category = 'HOME_GUARD' THEN 'HG'
                     WHEN o.rank = 'PC' AND o.constable_category IS NOT NULL THEN 'PC_' || o.constable_category
                     ELSE o.rank END AS cls, o.is_active AS active, count(*)::int AS n
           FROM officers o WHERE ${officerScopeSql(u, 'o.id', args)} GROUP BY 1, 2`,
        args,
      );
      const byClass: Record<string, { active: number; inactive: number }> = {};
      for (const r0 of rows) {
        byClass[r0.cls] ??= { active: 0, inactive: 0 };
        byClass[r0.cls]![r0.active ? 'active' : 'inactive'] += r0.n;
      }
      res.json({
        totalActive: rows.filter((x) => x.active).reduce((s, x) => s + x.n, 0),
        totalInactive: rows.filter((x) => !x.active).reduce((s, x) => s + x.n, 0),
        byClass,
      });
    }),
  );

  r.get(
    '/:id',
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      if (u.officerId !== id) {
        if (!can(u, 'personnel.view')) throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
        await assertOfficerInScope(ctx.pool, u, id);
      }
      const profile = (
        await ctx.pool.query(`SELECT ${PROFILE_COLS} FROM officers o LEFT JOIN units un ON un.id = o.unit_id WHERE o.id = $1`, [id])
      ).rows[0];
      if (!profile) throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
      const showAccount = u.officerId === id || can(u, 'users.manage');
      const canR = can(u, 'duty.view_restricted') || u.officerId === id;
      const [account, duties, checkins, unavailability, flags, auditRows] = await Promise.all([
        showAccount
          ? ctx.pool.query(
              `SELECT au.id, au.email, au.role, r.label AS "roleLabel", au.is_active AS "isActive", au.is_demo AS "isDemo", au.last_login_at AS "lastLoginAt"
                 FROM app_users au JOIN roles r ON r.code = au.role WHERE au.officer_id = $1`,
              [id],
            )
          : Promise.resolve({ rows: [] }),
        ctx.pool.query(
          `SELECT a.id, a.reference_code AS "referenceCode", a.category, c.label AS "categoryLabel",
              CASE WHEN NOT c.is_restricted OR $2::boolean THEN a.title ELSE c.label || ' (restricted details)' END AS title,
              a.planned_start AS "plannedStart", a.planned_end AS "plannedEnd", a.status AS "dutyStatus",
              p.status AS "personnelStatus", p.role_in_duty AS "roleInDuty", p.personnel_class AS "personnelClass",
              p.removal_reason AS "removalReason", s.device_started_at AS "deviceReportedStart", s.server_started_received_at AS "serverReceivedStart",
              (SELECT count(*)::int FROM checkins k WHERE k.duty_session_id = p.duty_session_id AND k.status IN ('ACKNOWLEDGED','ACKNOWLEDGED_LATE')) AS "checkinsAcknowledged",
              (SELECT count(*)::int FROM checkins k WHERE k.duty_session_id = p.duty_session_id AND k.status = 'MISSED') AS "checkinsMissed"
             FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id JOIN duty_categories c ON c.code = a.category
             LEFT JOIN duty_sessions s ON s.id = p.duty_session_id
            WHERE p.officer_id = $1 ORDER BY a.planned_start DESC LIMIT 200`,
          [id, canR],
        ),
        ctx.pool.query(
          `SELECT checkin_id AS "checkinId", duty_session_id AS "dutySessionId", scheduled_for AS "scheduledFor", status, response_ms AS "responseMs",
              late_by_ms AS "lateByMs", missed_reason AS "missedReason"
             FROM checkins WHERE officer_id = $1 ORDER BY scheduled_for DESC NULLS LAST LIMIT 50`,
          [id],
        ),
        ctx.pool.query(
          `SELECT pu.id, pu.starts_at AS "startsAt", pu.ends_at AS "endsAt", pu.category, pu.note, pu.cancelled_at AS "cancelledAt",
              ru.display_name AS "recordedByName", pu.recorded_at AS "recordedAt"
             FROM personnel_unavailability pu JOIN app_users ru ON ru.id = pu.recorded_by WHERE pu.officer_id = $1 ORDER BY pu.starts_at DESC LIMIT 100`,
          [id],
        ),
        can(u, 'exception.view') || u.officerId === id
          ? ctx.pool.query(
              `SELECT id, flag_type AS "flagType", severity, status, title, created_at AS "createdAt" FROM review_flags
                WHERE officer_id = $1 ORDER BY created_at DESC LIMIT 50`,
              [id],
            )
          : Promise.resolve({ rows: [] }),
        can(u, 'audit.view')
          ? ctx.pool.query(
              `SELECT a.sequence, a.occurred_at AS "occurredAt", a.action, a.actor_role AS "actorRole", au.display_name AS "actorName", a.details
                 FROM audit_events a LEFT JOIN app_users au ON au.id = a.actor_user_id
                WHERE a.target_type = 'personnel' AND a.target_id = $1 ORDER BY a.sequence DESC LIMIT 50`,
              [id],
            )
          : Promise.resolve({ rows: [] }),
      ]);
      res.json({
        profile: { ...profile, personnelClass: classOf(profile) },
        account: account.rows[0] ?? null,
        dutyHistory: duties.rows,
        checkins: checkins.rows,
        unavailability: unavailability.rows,
        exceptions: flags.rows,
        adminHistory: auditRows.rows,
      });
    }),
  );

  r.post(
    '/',
    requirePermission('personnel.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const b = createSchema.parse(req.body);
      await assertUnitInScope(u, b.unitId);
      const id = randomUUID();
      await withTransaction(ctx.pool, async (c) => {
        const dup = await c.query('SELECT 1 FROM officers WHERE employee_ref = $1', [b.personnelRef]);
        if (dup.rowCount) throw new AppError(409, 'CONFLICT', 'Personnel ID already exists.');
        const station = (await c.query<{ name: string }>('SELECT name FROM units WHERE id = $1', [b.unitId])).rows[0]?.name ?? 'Unassigned';
        await c.query(
          `INSERT INTO officers (id, employee_ref, display_name, rank, station, personnel_category, constable_category, gender, unit_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            b.personnelRef,
            b.displayName,
            b.personnelCategory === 'HOME_GUARD' ? null : b.rank,
            station.slice(0, 80),
            b.personnelCategory,
            b.rank === 'PC' ? (b.constableCategory ?? null) : null,
            b.gender,
            b.unitId,
          ],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'PERSONNEL_CREATED',
          targetType: 'personnel',
          targetId: id,
          requestId: reqId(req),
          details: { personnelRef: b.personnelRef, personnelCategory: b.personnelCategory, rank: b.rank ?? null, constableCategory: b.constableCategory ?? null, unitId: b.unitId },
        });
      });
      res.status(201).json({ id });
    }),
  );

  r.patch(
    '/:id',
    requirePermission('personnel.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      if (u.officerId === id)
        throw new AppError(403, 'SELF_MODIFICATION_FORBIDDEN', 'You cannot change your own personnel record, rank or unit.');
      await assertOfficerInScope(ctx.pool, u, id);
      const b = updateSchema.parse(req.body);
      if (b.unitId) await assertUnitInScope(u, b.unitId);
      await withTransaction(ctx.pool, async (c) => {
        const cur = (
          await c.query<{ display_name: string; personnel_category: string; rank: string | null; constable_category: string | null; gender: string; unit_id: string | null }>(
            'SELECT display_name, personnel_category, rank, constable_category, gender, unit_id FROM officers WHERE id = $1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!cur) throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
        const next = {
          display_name: b.displayName ?? cur.display_name,
          personnel_category: b.personnelCategory ?? cur.personnel_category,
          rank: b.rank !== undefined ? b.rank : cur.rank,
          constable_category: b.constableCategory !== undefined ? b.constableCategory : cur.constable_category,
          gender: b.gender ?? cur.gender,
          unit_id: b.unitId ?? cur.unit_id,
        };
        if (next.personnel_category === 'HOME_GUARD') {
          next.rank = null;
          next.constable_category = null;
        }
        if (next.rank !== 'PC') next.constable_category = null;
        const issues: string[] = [];
        checkClassification(
          { personnelCategory: next.personnel_category, rank: next.rank, constableCategory: next.constable_category },
          { addIssue: (i: { message?: string }) => issues.push(String(i.message)) } as unknown as z.RefinementCtx,
        );
        if (issues.length) throw new AppError(400, 'VALIDATION_FAILED', issues.join(' '));
        await c.query(
          `UPDATE officers SET display_name = $2, personnel_category = $3, rank = $4, constable_category = $5, gender = $6, unit_id = $7 WHERE id = $1`,
          [id, next.display_name, next.personnel_category, next.rank, next.constable_category, next.gender, next.unit_id],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'PERSONNEL_UPDATED',
          targetType: 'personnel',
          targetId: id,
          requestId: reqId(req),
          details: { before: cur, after: next, reason: b.reason },
        });
      });
      res.json({ ok: true });
    }),
  );

  /** Activate/deactivate. Never deletes; history, duties and evidence remain intact. */
  r.post(
    '/:id/status',
    requirePermission('personnel.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      if (u.officerId === id)
        throw new AppError(403, 'SELF_MODIFICATION_FORBIDDEN', 'You cannot change your own status.');
      await assertOfficerInScope(ctx.pool, u, id);
      const b = z.object({ isActive: z.boolean(), reason: z.string().trim().min(5).max(300) }).strict().parse(req.body);
      const flagged = await withTransaction(ctx.pool, async (c) => {
        const cur = (await c.query<{ is_active: boolean; display_name: string }>('SELECT is_active, display_name FROM officers WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!cur) throw new AppError(404, 'NOT_FOUND', 'Resource not found.');
        if (cur.is_active === b.isActive) return 0;
        await c.query('UPDATE officers SET is_active = $2 WHERE id = $1', [id, b.isActive]);
        await c.query('UPDATE app_users SET is_active = $2 WHERE officer_id = $1', [id, b.isActive]);
        if (!b.isActive)
          await c.query(
            "UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'PERSONNEL_DEACTIVATED' WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM app_users WHERE officer_id = $1)",
            [id],
          );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: b.isActive ? 'PERSONNEL_ACTIVATED' : 'PERSONNEL_DEACTIVATED',
          targetType: 'personnel',
          targetId: id,
          requestId: reqId(req),
          details: { reason: b.reason },
        });
        let n = 0;
        if (!b.isActive) {
          const open = await c.query<{ assignment_id: string; reference_code: string }>(
            `SELECT p.assignment_id, a.reference_code FROM duty_assignment_personnel p JOIN duty_assignments a ON a.id = p.assignment_id
              WHERE p.officer_id = $1 AND p.status IN ('ASSIGNED','ACCEPTED') AND a.status NOT IN ('COMPLETED','CANCELLED')`,
            [id],
          );
          for (const o of open.rows) {
            await raiseFlag(c, ctx.bus, {
              type: 'INACTIVE_PERSONNEL_ASSIGNED',
              severity: 'MEDIUM',
              title: 'Inactive personnel still assigned',
              description: `${cur.display_name} was deactivated but remains assigned to ${o.reference_code}. Reassign or remove with a reason.`,
              dedupeKey: `inactive:${id}:${o.assignment_id}`,
              officerId: id,
              dutyAssignmentId: o.assignment_id,
              inputs: { reason: b.reason },
            });
            n++;
          }
        }
        return n;
      });
      res.json({ ok: true, openAssignmentsFlagged: flagged });
    }),
  );

  // ---- Unavailability ---------------------------------------------------------------------
  r.post(
    '/:id/unavailability',
    requirePermission('availability.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertOfficerInScope(ctx.pool, u, id);
      const b = z
        .object({
          startsAt: isoQuery,
          endsAt: isoQuery,
          category: z.enum(['LEAVE', 'TRAINING', 'COURT_ATTENDANCE', 'MEDICAL', 'OTHER']),
          note: z.string().max(300).optional(),
        })
        .strict()
        .parse(req.body);
      const start = new Date(b.startsAt);
      const end = new Date(b.endsAt);
      if (end <= start) throw new AppError(400, 'VALIDATION_FAILED', 'endsAt must be after startsAt.');
      const out = await withTransaction(ctx.pool, async (c) => {
        const uid = randomUUID();
        // Conflicts with existing duties are flagged for review, never silently dropped.
        const conflicts = (await findConflicts(c, id, start, end, null)).filter((x) => x.type !== 'UNAVAILABLE');
        await c.query(
          `INSERT INTO personnel_unavailability (id, officer_id, starts_at, ends_at, category, note, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [uid, id, start, end, b.category, b.note ?? null, u.id],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'UNAVAILABILITY_RECORDED',
          targetType: 'personnel',
          targetId: id,
          requestId: reqId(req),
          details: { unavailabilityId: uid, startsAt: start.toISOString(), endsAt: end.toISOString(), category: b.category },
        });
        for (const x of conflicts)
          if (x.type === 'ASSIGNMENT')
            await raiseFlag(c, ctx.bus, {
              type: 'ASSIGNMENT_CONFLICT',
              severity: 'MEDIUM',
              title: 'Unavailability overlaps an assigned duty',
              description: `Recorded ${b.category} overlaps duty ${x.reference}. Review the roster.`,
              dedupeKey: `unavail:${uid}:${x.id}`,
              officerId: id,
              dutyAssignmentId: x.id,
              inputs: { unavailabilityId: uid, conflict: x },
            });
        return { id: uid, conflicts };
      });
      res.status(201).json(out);
    }),
  );

  r.post(
    '/:id/unavailability/:uid/cancel',
    requirePermission('availability.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      await assertOfficerInScope(ctx.pool, u, id);
      const uid = param(req, 'uid');
      await withTransaction(ctx.pool, async (c) => {
        const r0 = await c.query(
          'UPDATE personnel_unavailability SET cancelled_at = now(), cancelled_by = $3 WHERE id = $1 AND officer_id = $2 AND cancelled_at IS NULL',
          [uid, id, u.id],
        );
        if (!r0.rowCount) throw new AppError(404, 'NOT_FOUND', 'Unavailability not found or already cancelled.');
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'UNAVAILABILITY_CANCELLED',
          targetType: 'personnel',
          targetId: id,
          requestId: reqId(req),
          details: { unavailabilityId: uid },
        });
      });
      res.json({ ok: true });
    }),
  );
  return r;
}
