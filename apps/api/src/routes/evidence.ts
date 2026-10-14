import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, h, requireRole } from '../middleware/auth.js';
import { reqId } from '../middleware/request-id.js';
import { appendAudit } from '../services/audit.js';
import {
  buildPackageFor,
  custodyRecords,
  loadEvidence,
  readVerifiedBytes,
  renderEvidenceReport,
} from '../evidence/export.js';
import {
  assertOfficerScope,
  isoQuery,
  pageQuery,
  pageResult,
  paging,
  param,
  uuidParam,
} from './common.js';
import { sha256 } from '../security/tokens.js';

export function evidenceRoutes(ctx: AppContext): Router {
  const r = Router();
  const audit = (
    req: Parameters<typeof authUser>[0],
    action: string,
    evidenceId: string,
    details: Record<string, unknown> = {},
  ) => {
    const u = authUser(req);
    return withTransaction(ctx.pool, (c) =>
      appendAudit(c, {
        actorUserId: u.id,
        actorRole: u.role,
        action,
        targetType: 'evidence',
        targetId: evidenceId,
        evidenceId,
        requestId: reqId(req),
        details,
      }),
    );
  };

  r.get(
    '/',
    requireRole('ADMIN', 'SUPERVISOR', 'REVIEWER'),
    h(async (req, res) => {
      const q = pageQuery
        .extend({
          status: z.enum(['AWAITING_UPLOAD', 'VERIFIED', 'QUARANTINED']).optional(),
          officerId: uuidParam.optional(),
          hash: z
            .string()
            .regex(/^[0-9a-f]{4,64}$/)
            .optional(),
          from: isoQuery.optional(),
          to: isoQuery.optional(),
        })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const where: string[] = [];
      const args: unknown[] = [];
      const push = (sql: string, v: unknown) => {
        args.push(v);
        where.push(sql.replace('?', `$${args.length}`));
      };
      if (q.status) push('e.status = ?', q.status);
      if (q.officerId) push('e.officer_id = ?', q.officerId);
      if (q.hash) push('e.declared_image_sha256 LIKE ?', `${q.hash}%`);
      if (q.from) push('e.created_at >= ?', new Date(q.from));
      if (q.to) push('e.created_at <= ?', new Date(q.to));
      const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const total = (
        await ctx.pool.query<{ n: number }>(
          `SELECT count(*)::int n FROM evidence_objects e ${w}`,
          args,
        )
      ).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT e.evidence_id AS "evidenceId", e.status, e.officer_id AS "officerId", o.display_name AS "officerName", e.duty_session_id AS "dutySessionId",
              e.declared_image_sha256 AS "imageSha256", e.manifest->'capture'->>'deviceWallTime' AS "capturedAtDevice",
              d.server_received_at AS "serverReceivedAt", e.verified_at AS "verifiedAt", (e.screen_risk->>'score')::float AS "screenRiskScore", o.is_demo AS "isDemo"
         FROM evidence_objects e JOIN officers o ON o.id = e.officer_id JOIN device_events d ON d.event_id = e.event_id ${w}
        ORDER BY e.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
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
      const ev = await loadEvidence(ctx, id);
      const u = authUser(req);
      assertOfficerScope(u, ev.officer_id);
      const event = (
        await ctx.pool.query<{
          device_sequence_number: number;
          previous_event_hash: string;
          event_hash: string;
          server_received_at: Date;
          server_processed_at: Date;
          device_id: string;
        }>(
          'SELECT device_sequence_number, previous_event_hash, event_hash, server_received_at, server_processed_at, device_id FROM device_events WHERE event_id = $1',
          [ev.event_id],
        )
      ).rows[0]!;
      const neighbours = (
        await ctx.pool.query(
          `SELECT event_id AS "eventId", device_sequence_number AS sequence, event_type AS "eventType", event_hash AS "eventHash", previous_event_hash AS "previousEventHash", device_wall_time AS "deviceWallTime"
         FROM device_events WHERE device_id = $1 AND device_sequence_number BETWEEN $2 - 1 AND $2 + 1 ORDER BY device_sequence_number`,
          [event.device_id, event.device_sequence_number],
        )
      ).rows;
      const officer = (
        await ctx.pool.query(
          'SELECT display_name AS "displayName", employee_ref AS "employeeRef", is_demo AS "isDemo" FROM officers WHERE id = $1',
          [ev.officer_id],
        )
      ).rows[0];
      await audit(req, 'EVIDENCE_METADATA_VIEWED', id);
      res.json({
        evidenceId: ev.evidence_id,
        eventId: ev.event_id,
        status: ev.status,
        officer,
        officerId: ev.officer_id,
        deviceId: ev.device_id,
        dutySessionId: ev.duty_session_id,
        imageSha256: ev.declared_image_sha256,
        computedImageSha256: ev.computed_image_sha256,
        manifestSha256: ev.manifest_sha256,
        manifest: ev.manifest,
        mediaType: ev.media_type,
        declaredByteLength: ev.declared_byte_length,
        receivedByteLength: ev.received_byte_length,
        verificationDetail: ev.verification_detail,
        screenRecaptureRisk: ev.screen_risk,
        uploadAttempts: ev.upload_attempts,
        times: {
          deviceWallTime: (ev.manifest as { capture: { deviceWallTime: string } }).capture
            .deviceWallTime,
          trustedTimeEstimate: (ev.manifest as { capture: { trustedTimeEstimate: string | null } })
            .capture.trustedTimeEstimate,
          serverReceivedAt: event.server_received_at,
          serverProcessedAt: event.server_processed_at,
          uploadReceivedAt: ev.upload_received_at,
          verifiedAt: ev.verified_at,
        },
        ledger: {
          sequence: event.device_sequence_number,
          eventHash: event.event_hash,
          previousEventHash: event.previous_event_hash,
          neighbours,
        },
        canViewImage: u.role === 'ADMIN' || u.role === 'SUPERVISOR',
        custody: await custodyRecords(ctx, id),
      });
    }),
  );

  /** Image bytes: SUPERVISOR/ADMIN only; re-verified on every read; audited. */
  r.get(
    '/:id/content',
    requireRole('ADMIN', 'SUPERVISOR'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const ev = await loadEvidence(ctx, id);
      const bytes = await readVerifiedBytes(ctx, ev);
      await audit(req, 'EVIDENCE_CONTENT_VIEWED', id, { sha256: ev.declared_image_sha256 });
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Content-SHA256', ev.declared_image_sha256);
      res.send(bytes);
    }),
  );

  r.get(
    '/:id/manifest.json',
    requireRole('ADMIN', 'SUPERVISOR', 'REVIEWER'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const ev = await loadEvidence(ctx, id);
      await audit(req, 'EVIDENCE_EXPORTED', id, { format: 'manifest-json' });
      res.setHeader('Content-Disposition', `attachment; filename="pramaan-manifest-${id}.json"`);
      res.json({
        evidenceId: id,
        manifestSha256: ev.manifest_sha256,
        manifest: ev.manifest,
        serverStatus: ev.status,
        exportedAt: new Date().toISOString(),
      });
    }),
  );

  r.get(
    '/:id/package',
    requireRole('ADMIN', 'SUPERVISOR'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const u = authUser(req);
      const ev = await loadEvidence(ctx, id);
      const { zip } = await buildPackageFor(ctx, ev, `user:${u.id}`);
      const digest = sha256(Buffer.from(zip));
      await audit(req, 'EVIDENCE_EXPORTED', id, {
        format: 'evidence-package-zip',
        packageSha256: digest,
        bytes: zip.byteLength,
      });
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="pramaan-evidence-${id}.zip"`);
      res.setHeader('X-Package-SHA256', digest);
      res.send(Buffer.from(zip));
    }),
  );

  r.get(
    '/:id/report.pdf',
    requireRole('ADMIN', 'SUPERVISOR', 'REVIEWER'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const u = authUser(req);
      const ev = await loadEvidence(ctx, id);
      const pdf = await renderEvidenceReport(ctx, ev, `${u.role} ${u.id}`);
      await audit(req, 'EVIDENCE_EXPORTED', id, {
        format: 'report-pdf',
        reportSha256: sha256(pdf),
      });
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="pramaan-evidence-report-${id}.pdf"`,
      );
      res.send(pdf);
    }),
  );
  return r;
}
