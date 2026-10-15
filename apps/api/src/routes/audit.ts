import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, h, requirePermission, type AuthUser } from '../middleware/auth.js';
import { assignmentScopeSql, officerScopeSql } from '../security/access.js';
import { reqId } from '../middleware/request-id.js';
import {
  appendAudit,
  rowToAuditRecord,
  verifyFullAuditChain,
  type AuditRow,
} from '../services/audit.js';
import { pageQuery, pageResult, paging, uuidParam } from './common.js';

/**
 * Audit scope for non-global users: records whose actor is personnel in scope, or whose target is a
 * personnel record, duty assignment or evidence object in scope. Global (ALL) users see everything.
 */
export function auditScopeSql(u: AuthUser, args: unknown[]): string {
  if (u.scope.level === 'ALL') return 'TRUE';
  const actor = officerScopeSql(u, 'au.officer_id', args);
  const person = officerScopeSql(u, 'po.id', args);
  const ev = officerScopeSql(u, 'eo.officer_id', args);
  const asg = assignmentScopeSql(u, 'sa', args);
  return `(EXISTS (SELECT 1 FROM app_users au WHERE au.id = a.actor_user_id AND au.officer_id IS NOT NULL AND ${actor})
    OR (a.target_type IN ('personnel','officer') AND EXISTS (SELECT 1 FROM officers po WHERE po.id::text = a.target_id AND ${person}))
    OR (a.evidence_id IS NOT NULL AND EXISTS (SELECT 1 FROM evidence_objects eo WHERE eo.evidence_id = a.evidence_id AND ${ev}))
    OR (a.target_type = 'duty_assignment' AND EXISTS (SELECT 1 FROM duty_assignments sa WHERE sa.id::text = a.target_id AND ${asg})))`;
}

export function auditRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    requirePermission('audit.view'),
    h(async (req, res) => {
      const u = authUser(req);
      const q = pageQuery
        .extend({
          action: z
            .string()
            .regex(/^[A-Z_]{3,60}$/)
            .optional(),
          evidenceId: uuidParam.optional(),
          actorUserId: uuidParam.optional(),
          targetType: z
            .string()
            .regex(/^[a-z_]{2,40}$/)
            .optional(),
          targetId: z.string().max(80).optional(),
        })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      const where: string[] = [auditScopeSql(u, args)];
      if (q.targetType) {
        args.push(q.targetType);
        where.push(`a.target_type = $${args.length}`);
      }
      if (q.targetId) {
        args.push(q.targetId);
        where.push(`a.target_id = $${args.length}`);
      }
      if (q.action) {
        args.push(q.action);
        where.push(`a.action = $${args.length}`);
      }
      if (q.evidenceId) {
        args.push(q.evidenceId);
        where.push(`a.evidence_id = $${args.length}`);
      }
      if (q.actorUserId) {
        args.push(q.actorUserId);
        where.push(`a.actor_user_id = $${args.length}`);
      }
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (
        await ctx.pool.query<{ n: number }>(`SELECT count(*)::int n FROM audit_events a ${w}`, args)
      ).rows[0]!.n;
      const { rows } = await ctx.pool.query<AuditRow & { actor_name: string | null }>(
        `SELECT a.*, u.display_name AS actor_name FROM audit_events a LEFT JOIN app_users u ON u.id = a.actor_user_id ${w} ORDER BY a.sequence DESC LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(
        pageResult(
          rows.map((r) => ({ ...rowToAuditRecord(r), actorName: r.actor_name })),
          total,
          q,
        ),
      );
    }),
  );

  /** Latest chain head. Store it independently (e.g. print, email, another system) to detect later rewrites. */
  r.get(
    '/checkpoint',
    requirePermission('audit.view'),
    h(async (_req, res) => {
      const head = (
        await ctx.pool.query<{ last_sequence: number; last_hash: string }>(
          'SELECT last_sequence, last_hash FROM audit_chain_head WHERE id = 1',
        )
      ).rows[0]!;
      res.json({
        sequence: head.last_sequence,
        recordHash: head.last_hash,
        issuedAt: new Date().toISOString(),
      });
    }),
  );

  r.get(
    '/verify',
    requirePermission('audit.verify'),
    h(async (req, res) => {
      const result = await verifyFullAuditChain(ctx.pool);
      const u = authUser(req);
      await withTransaction(ctx.pool, (c) =>
        appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'AUDIT_CHAIN_VERIFIED',
          targetType: 'audit_chain',
          requestId: reqId(req),
          details: { ok: result.ok, checked: result.checked, issues: result.issues.length },
        }),
      );
      res.json(result);
    }),
  );
  return r;
}
