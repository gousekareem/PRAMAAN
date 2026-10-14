import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, h, requireRole } from '../middleware/auth.js';
import { reqId } from '../middleware/request-id.js';
import {
  appendAudit,
  rowToAuditRecord,
  verifyFullAuditChain,
  type AuditRow,
} from '../services/audit.js';
import { pageQuery, pageResult, paging, uuidParam } from './common.js';

export function auditRoutes(ctx: AppContext): Router {
  const r = Router();
  r.get(
    '/',
    requireRole('ADMIN', 'SUPERVISOR'),
    h(async (req, res) => {
      const q = pageQuery
        .extend({
          action: z
            .string()
            .regex(/^[A-Z_]{3,60}$/)
            .optional(),
          evidenceId: uuidParam.optional(),
          actorUserId: uuidParam.optional(),
        })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const where: string[] = [];
      const args: unknown[] = [];
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
    requireRole('ADMIN', 'SUPERVISOR'),
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
    requireRole('ADMIN'),
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
