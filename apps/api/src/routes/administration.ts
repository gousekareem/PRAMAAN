import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, rm, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, h, requireAnyPermission, requirePermission } from '../middleware/auth.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import { hashPassword, passwordPolicyIssues } from '../security/passwords.js';
import { appendAudit, verifyFullAuditChain } from '../services/audit.js';
import { DUTY_CATEGORIES } from '../services/duties.js';
import { pageQuery, pageResult, paging, param, uuidParam } from './common.js';

const PERSONNEL_CLASSES = ['HG', 'PC_AR', 'PC_GENERAL', 'PC', 'HC', 'ASI', 'SI', 'CI', 'DSP', 'OTHER'] as const;

/** Organisational units (names are not sensitive; the tree is returned to every signed-in user). */
export function unitRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    h(async (_req, res) => {
      const { rows } = await ctx.pool.query(
        `SELECT u.id, u.code, u.name, u.unit_type AS "unitType", u.parent_id AS "parentId", u.is_active AS "isActive", u.is_demo AS "isDemo",
                z.code AS "geoZoneCode"
           FROM units u LEFT JOIN geo_zones z ON z.id = u.geo_zone_id ORDER BY u.unit_type, u.name`,
      );
      res.json({ items: rows });
    }),
  );
  return r;
}

const accountCreate = z
  .object({
    email: z.string().email().max(120).transform((s) => s.toLowerCase()),
    displayName: z.string().trim().min(2).max(80),
    role: z.string().regex(/^[A-Z_]{2,32}$/),
    officerId: uuidParam.nullable().optional(),
    password: z.string().min(12).max(256),
  })
  .strict();

/** Login accounts (separate from personnel records). */
export function accountRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    requirePermission('users.manage'),
    h(async (req, res) => {
      const q = pageQuery.extend({ q: z.string().max(60).optional() }).parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      let w = '';
      if (q.q) {
        args.push(`%${q.q}%`);
        w = `WHERE u.email ILIKE $1 OR u.display_name ILIKE $1`;
      }
      const total = (await ctx.pool.query<{ n: number }>(`SELECT count(*)::int n FROM app_users u ${w}`, args)).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT u.id, u.email, u.display_name AS "displayName", u.role, r.label AS "roleLabel", u.officer_id AS "officerId",
            o.employee_ref AS "personnelRef", u.is_active AS "isActive", u.is_demo AS "isDemo", u.last_login_at AS "lastLoginAt",
            u.locked_until AS "lockedUntil", u.created_at AS "createdAt"
           FROM app_users u JOIN roles r ON r.code = u.role LEFT JOIN officers o ON o.id = u.officer_id ${w}
          ORDER BY r.sort_order, u.display_name LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );

  r.post(
    '/',
    requirePermission('users.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const b = accountCreate.parse(req.body);
      const issues = passwordPolicyIssues(b.password);
      if (issues.length) throw new AppError(400, 'VALIDATION_FAILED', `Password needs ${issues.join(', ')}.`);
      const id = randomUUID();
      const hash = await hashPassword(b.password);
      await withTransaction(ctx.pool, async (c) => {
        const role = (await c.query<{ requires_personnel: boolean }>('SELECT requires_personnel FROM roles WHERE code = $1', [b.role])).rows[0];
        if (!role) throw new AppError(400, 'VALIDATION_FAILED', 'Unknown role.');
        if (role.requires_personnel && !b.officerId)
          throw new AppError(400, 'VALIDATION_FAILED', 'This role must be linked to a personnel record.');
        if (b.officerId) {
          const o = (await c.query<{ is_active: boolean }>('SELECT is_active FROM officers WHERE id = $1', [b.officerId])).rows[0];
          if (!o?.is_active) throw new AppError(400, 'INACTIVE_PERSONNEL', 'Personnel record not found or inactive.');
          const taken = await c.query('SELECT 1 FROM app_users WHERE officer_id = $1', [b.officerId]);
          if (taken.rowCount) throw new AppError(409, 'CONFLICT', 'This personnel record already has a login account.');
        }
        const dup = await c.query('SELECT 1 FROM app_users WHERE email = $1', [b.email]);
        if (dup.rowCount) throw new AppError(409, 'CONFLICT', 'Email already in use.');
        await c.query(
          'INSERT INTO app_users (id, email, display_name, role, password_hash, officer_id) VALUES ($1,$2,$3,$4,$5,$6)',
          [id, b.email, b.displayName, b.role, hash, b.officerId ?? null],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'ACCOUNT_CREATED',
          targetType: 'user',
          targetId: id,
          requestId: reqId(req),
          details: { role: b.role, officerId: b.officerId ?? null },
        });
      });
      res.status(201).json({ id });
    }),
  );

  /** Role / status changes. Users can never change their own role or status (no self-escalation). */
  r.patch(
    '/:id',
    requirePermission('users.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      if (id === u.id)
        throw new AppError(403, 'SELF_MODIFICATION_FORBIDDEN', 'You cannot change your own role or account status.');
      const b = z
        .object({
          role: z.string().regex(/^[A-Z_]{2,32}$/).optional(),
          isActive: z.boolean().optional(),
          displayName: z.string().trim().min(2).max(80).optional(),
          reason: z.string().trim().min(5).max(300),
        })
        .strict()
        .parse(req.body);
      await withTransaction(ctx.pool, async (c) => {
        const cur = (
          await c.query<{ role: string; is_active: boolean; display_name: string; officer_id: string | null }>(
            'SELECT role, is_active, display_name, officer_id FROM app_users WHERE id = $1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!cur) throw new AppError(404, 'NOT_FOUND', 'Account not found.');
        if (b.role) {
          const role = (await c.query<{ requires_personnel: boolean }>('SELECT requires_personnel FROM roles WHERE code = $1', [b.role])).rows[0];
          if (!role) throw new AppError(400, 'VALIDATION_FAILED', 'Unknown role.');
          if (role.requires_personnel && !cur.officer_id)
            throw new AppError(400, 'VALIDATION_FAILED', 'This role must be linked to a personnel record.');
        }
        await c.query(
          'UPDATE app_users SET role = COALESCE($2, role), is_active = COALESCE($3, is_active), display_name = COALESCE($4, display_name) WHERE id = $1',
          [id, b.role ?? null, b.isActive ?? null, b.displayName ?? null],
        );
        // Any privilege or status change ends existing sessions so new permissions apply immediately.
        if ((b.role && b.role !== cur.role) || b.isActive === false)
          await c.query(
            "UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'ACCOUNT_CHANGED' WHERE user_id = $1 AND revoked_at IS NULL",
            [id],
          );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'ACCOUNT_UPDATED',
          targetType: 'user',
          targetId: id,
          requestId: reqId(req),
          details: {
            before: { role: cur.role, isActive: cur.is_active, displayName: cur.display_name },
            after: { role: b.role ?? cur.role, isActive: b.isActive ?? cur.is_active, displayName: b.displayName ?? cur.display_name },
            reason: b.reason,
          },
        });
      });
      res.json({ ok: true });
    }),
  );

  r.post(
    '/:id/reset-password',
    requirePermission('users.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const id = param(req, 'id');
      if (id === u.id) throw new AppError(403, 'SELF_MODIFICATION_FORBIDDEN', 'Use “change password” for your own account.');
      const { password } = z.object({ password: z.string().min(12).max(256) }).strict().parse(req.body);
      const issues = passwordPolicyIssues(password);
      if (issues.length) throw new AppError(400, 'VALIDATION_FAILED', `Password needs ${issues.join(', ')}.`);
      const hash = await hashPassword(password);
      await withTransaction(ctx.pool, async (c) => {
        const r0 = await c.query('UPDATE app_users SET password_hash = $2, failed_login_count = 0, locked_until = NULL WHERE id = $1', [id, hash]);
        if (!r0.rowCount) throw new AppError(404, 'NOT_FOUND', 'Account not found.');
        await c.query("UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'PASSWORD_RESET' WHERE user_id = $1 AND revoked_at IS NULL", [id]);
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'ACCOUNT_PASSWORD_RESET',
          targetType: 'user',
          targetId: id,
          requestId: reqId(req),
        });
      });
      res.json({ ok: true });
    }),
  );
  return r;
}

const categoryPatch = z
  .object({
    isRestricted: z.boolean().optional(),
    minPersonnel: z.number().int().min(1).max(50).optional(),
    requiresSupervisor: z.boolean().optional(),
    acceptRequired: z.boolean().optional(),
    eligibilityMode: z.enum(['BLOCK', 'WARN']).optional(),
    checkinMinIntervalMin: z.number().int().min(5).max(600).optional(),
    checkinMaxIntervalMin: z.number().int().min(5).max(600).optional(),
    responseWindowSec: z.number().int().min(30).max(1800).optional(),
    reportingWindowMin: z.number().int().min(0).max(240).optional(),
    graceMin: z.number().int().min(0).max(120).optional(),
    maxDurationHours: z.number().int().min(1).max(16).optional(),
    eligible: z.array(z.enum(PERSONNEL_CLASSES)).max(10).optional(),
    reason: z.string().trim().min(5).max(300),
  })
  .strict();

const CATEGORY_COLS = `c.code, c.label, c.description, c.is_restricted AS "isRestricted", c.min_personnel AS "minPersonnel",
  c.requires_supervisor AS "requiresSupervisor", c.accept_required AS "acceptRequired", c.eligibility_mode AS "eligibilityMode",
  c.checkin_min_interval_min AS "checkinMinIntervalMin", c.checkin_max_interval_min AS "checkinMaxIntervalMin",
  c.response_window_sec AS "responseWindowSec", c.reporting_window_min AS "reportingWindowMin", c.grace_min AS "graceMin",
  c.max_duration_hours AS "maxDurationHours", c.policy_version AS "policyVersion", c.requires_validation_note AS "validationNote",
  c.updated_at AS "updatedAt",
  COALESCE((SELECT array_agg(e.personnel_class ORDER BY e.personnel_class) FROM duty_category_eligibility e WHERE e.category_code = c.code), '{}') AS eligible`;

/** Configurable duty policy and role permissions (prototype defaults; validate with the department). */
export function policyRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/duty-categories',
    h(async (_req, res) => {
      const { rows } = await ctx.pool.query(
        `SELECT ${CATEGORY_COLS} FROM duty_categories c ORDER BY array_position(ARRAY['TRAIN_BEAT','STATION_WATCH','VIP_ESCORT','TRACK_INCIDENT'], c.code)`,
      );
      res.json({ items: rows, personnelClasses: PERSONNEL_CLASSES });
    }),
  );

  r.patch(
    '/duty-categories/:code',
    requirePermission('policy.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const code = z.enum(DUTY_CATEGORIES).parse(req.params.code);
      const b = categoryPatch.parse(req.body);
      await withTransaction(ctx.pool, async (c) => {
        const before = (await c.query(`SELECT ${CATEGORY_COLS} FROM duty_categories c WHERE c.code = $1 FOR UPDATE`, [code])).rows[0];
        const map: [keyof typeof b, string][] = [
          ['isRestricted', 'is_restricted'],
          ['minPersonnel', 'min_personnel'],
          ['requiresSupervisor', 'requires_supervisor'],
          ['acceptRequired', 'accept_required'],
          ['eligibilityMode', 'eligibility_mode'],
          ['checkinMinIntervalMin', 'checkin_min_interval_min'],
          ['checkinMaxIntervalMin', 'checkin_max_interval_min'],
          ['responseWindowSec', 'response_window_sec'],
          ['reportingWindowMin', 'reporting_window_min'],
          ['graceMin', 'grace_min'],
          ['maxDurationHours', 'max_duration_hours'],
        ];
        const sets: string[] = [];
        const vals: unknown[] = [code];
        for (const [k, col] of map)
          if (b[k] !== undefined) {
            vals.push(b[k]);
            sets.push(`${col} = $${vals.length}`);
          }
        vals.push(u.id);
        sets.push(`updated_by = $${vals.length}`, 'updated_at = now()', 'policy_version = policy_version + 1');
        await c.query(`UPDATE duty_categories SET ${sets.join(', ')} WHERE code = $1`, vals).catch((e: Error) => {
          throw new AppError(400, 'VALIDATION_FAILED', `Policy rejected: ${e.message}`);
        });
        if (b.eligible) {
          await c.query('DELETE FROM duty_category_eligibility WHERE category_code = $1', [code]);
          for (const cls of new Set(b.eligible))
            await c.query('INSERT INTO duty_category_eligibility (category_code, personnel_class) VALUES ($1,$2)', [code, cls]);
        }
        const after = (await c.query(`SELECT ${CATEGORY_COLS} FROM duty_categories c WHERE c.code = $1`, [code])).rows[0];
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'DUTY_POLICY_UPDATED',
          targetType: 'duty_category',
          targetId: code,
          requestId: reqId(req),
          details: JSON.parse(JSON.stringify({ before, after, reason: b.reason })) as Record<string, unknown>,
        });
      });
      const row = (await ctx.pool.query(`SELECT ${CATEGORY_COLS} FROM duty_categories c WHERE c.code = $1`, [code])).rows[0];
      res.json(row);
    }),
  );

  r.get(
    '/roles',
    requireAnyPermission('policy.manage', 'users.manage'),
    h(async (_req, res) => {
      const roles = await ctx.pool.query(
        `SELECT r.code, r.label, r.description, r.scope_level AS "scopeLevel", r.requires_personnel AS "requiresPersonnel", r.is_rank_role AS "isRankRole",
            COALESCE((SELECT array_agg(rp.permission_code ORDER BY rp.permission_code) FROM role_permissions rp WHERE rp.role_code = r.code), '{}') AS permissions
           FROM roles r ORDER BY r.sort_order`,
      );
      const perms = await ctx.pool.query('SELECT code, description FROM permissions ORDER BY code');
      res.json({ roles: roles.rows, permissions: perms.rows });
    }),
  );

  r.put(
    '/roles/:code/permissions',
    requirePermission('policy.manage'),
    h(async (req, res) => {
      const u = authUser(req);
      const code = z.string().regex(/^[A-Z_]{2,32}$/).parse(req.params.code);
      const b = z
        .object({ permissions: z.array(z.string().regex(/^[a-z_]+(\.[a-z_]+)+$/)).max(60), reason: z.string().trim().min(5).max(300) })
        .strict()
        .parse(req.body);
      if (code === u.role && (!b.permissions.includes('policy.manage') || !b.permissions.includes('users.manage')))
        throw new AppError(403, 'SELF_MODIFICATION_FORBIDDEN', 'You cannot remove policy/account administration from your own role (lock-out guard).');
      await withTransaction(ctx.pool, async (c) => {
        const role = await c.query('SELECT 1 FROM roles WHERE code = $1', [code]);
        if (!role.rowCount) throw new AppError(404, 'NOT_FOUND', 'Role not found.');
        const known = await c.query<{ code: string }>('SELECT code FROM permissions WHERE code = ANY($1::text[])', [b.permissions]);
        if (known.rowCount !== new Set(b.permissions).size) throw new AppError(400, 'VALIDATION_FAILED', 'Unknown permission code.');
        const before = (await c.query<{ p: string[] }>('SELECT COALESCE(array_agg(permission_code ORDER BY permission_code), \'{}\') p FROM role_permissions WHERE role_code = $1', [code])).rows[0]!.p;
        await c.query('DELETE FROM role_permissions WHERE role_code = $1', [code]);
        for (const p of new Set(b.permissions))
          await c.query('INSERT INTO role_permissions (role_code, permission_code) VALUES ($1,$2)', [code, p]);
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'ROLE_PERMISSIONS_UPDATED',
          targetType: 'role',
          targetId: code,
          requestId: reqId(req),
          details: { before, after: [...new Set(b.permissions)].sort(), reason: b.reason },
        });
      });
      res.json({ ok: true });
    }),
  );
  return r;
}

/**
 * Protected operational status. Every value is measured at request time; backup status is shown
 * only when a verification result file written by scripts/backup-restore-check.sh exists.
 */
export function systemRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/status',
    requirePermission('system.health'),
    h(async (_req, res) => {
      const t0 = Date.now();
      let database: Record<string, unknown>;
      try {
        const v = await ctx.pool.query<{ pg: string; postgis: string; migrations: number; latest: string }>(
          `SELECT current_setting('server_version') AS pg, postgis_lib_version() AS postgis,
                  (SELECT count(*)::int FROM schema_migrations) AS migrations, (SELECT max(name) FROM schema_migrations) AS latest`,
        );
        database = { status: 'ok', latencyMs: Date.now() - t0, ...v.rows[0], pool: { total: ctx.pool.totalCount, idle: ctx.pool.idleCount, waiting: ctx.pool.waitingCount } };
      } catch (e) {
        database = { status: 'error', error: (e as Error).message };
      }
      let storage: Record<string, unknown>;
      const dir = ctx.env.EVIDENCE_STORAGE_DIR;
      try {
        await mkdir(dir, { recursive: true });
        await access(dir, fsConstants.W_OK | fsConstants.R_OK);
        const probe = join(dir, `.status-probe-${randomUUID()}`);
        await writeFile(probe, 'probe');
        const back = await readFile(probe, 'utf8');
        await rm(probe);
        const fsStat = await statfs(dir);
        storage = {
          status: back === 'probe' ? 'ok' : 'error',
          writable: true,
          freeBytes: Number(fsStat.bavail) * Number(fsStat.bsize),
          totalBytes: Number(fsStat.blocks) * Number(fsStat.bsize),
        };
      } catch (e) {
        storage = { status: 'error', writable: false, error: (e as Error).message };
      }
      const sync = (
        await ctx.pool.query(
          `SELECT (SELECT max(received_at) FROM sync_batches) AS "lastBatchReceivedAt",
                  (SELECT count(*)::int FROM sync_batches WHERE received_at > now() - interval '24 hours') AS "batches24h",
                  (SELECT count(*)::int FROM ingestion_rejections WHERE received_at > now() - interval '24 hours') AS "rejections24h",
                  (SELECT count(*)::int FROM evidence_objects WHERE status = 'AWAITING_UPLOAD') AS "evidenceAwaitingUpload",
                  (SELECT count(*)::int FROM evidence_objects WHERE status = 'QUARANTINED') AS "evidenceQuarantined",
                  (SELECT count(*)::int FROM devices WHERE status = 'ACTIVE') AS "activeDevices",
                  (SELECT count(*)::int FROM review_flags WHERE flag_type = 'SYNC_FAILURE' AND status IN ('OPEN','ACKNOWLEDGED','ASSIGNED')) AS "openSyncFailures"`,
        )
      ).rows[0];
      let backup: Record<string, unknown> = {
        status: 'NOT_AVAILABLE',
        detail: 'No backup verification result has been recorded on this server (set BACKUP_VERIFICATION_FILE).',
      };
      if (ctx.env.BACKUP_VERIFICATION_FILE) {
        try {
          const parsed = JSON.parse(await readFile(ctx.env.BACKUP_VERIFICATION_FILE, 'utf8')) as Record<string, unknown>;
          backup = { status: parsed.passed === true ? 'VERIFIED' : 'FAILED', ...parsed };
        } catch {
          backup = { status: 'NOT_AVAILABLE', detail: 'Configured verification file could not be read.' };
        }
      }
      const auditChain = await verifyFullAuditChain(ctx.pool).then(
        (v) => ({ ok: v.ok, checked: v.checked, issues: v.issues.length }),
        (e: Error) => ({ ok: false, error: e.message }),
      );
      res.json({
        generatedAt: new Date().toISOString(),
        api: { status: 'ok', uptimeSeconds: Math.round(process.uptime()), node: process.version, environment: ctx.env.NODE_ENV },
        database,
        evidenceStorage: storage,
        synchronisation: sync,
        auditChain,
        backup,
        demoLoginAllowed: ctx.env.demoLoginAllowed,
      });
    }),
  );
  return r;
}
