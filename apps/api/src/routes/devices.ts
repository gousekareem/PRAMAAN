import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { authUser, h, requirePermission } from '../middleware/auth.js';
import { officerScopeSql } from '../security/access.js';
import { AppError } from '../middleware/errors.js';
import { reqId } from '../middleware/request-id.js';
import { parseDevicePublicKey } from '../security/device-keys.js';
import { appendAudit } from '../services/audit.js';
import { raiseFlag } from '../services/flags.js';
import { pageQuery, pageResult, paging, param, uuidParam } from './common.js';

const registerSchema = z
  .object({
    deviceId: uuidParam,
    label: z.string().min(1).max(80),
    platform: z.enum(['ANDROID', 'SIMULATOR']),
    publicKeySpki: z.string().min(80).max(400),
    keyAlgorithm: z.literal('ECDSA_P256_SHA256'),
    keyHardwareBacked: z.boolean().nullable(),
    appVersion: z.string().max(40),
  })
  .strict();

const cols = `d.id, d.officer_id AS "officerId", o.display_name AS "officerName", d.label, d.platform, d.status, d.key_algorithm AS "keyAlgorithm",
  d.key_fingerprint AS "keyFingerprint", d.key_hardware_backed AS "keyHardwareBacked", d.app_version AS "appVersion", d.is_demo AS "isDemo",
  d.registered_at AS "registeredAt", d.approved_at AS "approvedAt", d.revoked_at AS "revokedAt", d.revocation_reason AS "revocationReason", d.last_seen_at AS "lastSyncAt",
  h.last_sequence AS "lastSequence", h.last_event_hash AS "lastEventHash"`;

export function deviceRoutes(ctx: AppContext): Router {
  const r = Router();

  /** Officer registers a device public key. Private keys never leave the device. Status starts PENDING. */
  r.post(
    '/register',
    requirePermission('checkin.perform'),
    h(async (req, res) => {
      const u = authUser(req);
      if (!u.officerId)
        throw new AppError(403, 'FORBIDDEN', 'Only accounts linked to personnel can register devices.');
      const b = registerSchema.parse(req.body);
      const key = parseDevicePublicKey(b.publicKeySpki);
      if (!key)
        throw new AppError(
          400,
          'VALIDATION_FAILED',
          'publicKeySpki must be a base64 DER SubjectPublicKeyInfo for an EC P-256 key.',
        );
      const existing = (
        await ctx.pool.query<{ officer_id: string; key_fingerprint: string; status: string }>(
          'SELECT officer_id, key_fingerprint, status FROM devices WHERE id = $1',
          [b.deviceId],
        )
      ).rows[0];
      if (existing) {
        if (existing.officer_id === u.officerId && existing.key_fingerprint === key.fingerprint) {
          res.json({
            deviceId: b.deviceId,
            status: existing.status,
            keyFingerprint: key.fingerprint,
            alreadyRegistered: true,
          });
          return;
        }
        throw new AppError(
          409,
          'CONFLICT',
          'Device ID already registered with a different key or officer. Generate a new device ID after reinstall.',
        );
      }
      await withTransaction(ctx.pool, async (c) => {
        await c.query(
          `INSERT INTO devices (id, officer_id, label, platform, key_algorithm, public_key_spki, key_fingerprint, key_hardware_backed, app_version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            b.deviceId,
            u.officerId,
            b.label,
            b.platform,
            b.keyAlgorithm,
            b.publicKeySpki,
            key.fingerprint,
            b.keyHardwareBacked,
            b.appVersion,
          ],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'DEVICE_REGISTERED',
          targetType: 'device',
          targetId: b.deviceId,
          requestId: reqId(req),
          details: {
            keyFingerprint: key.fingerprint,
            platform: b.platform,
            keyHardwareBacked: b.keyHardwareBacked,
          },
        });
        await raiseFlag(c, ctx.bus, {
          type: 'DEVICE_REGISTRATION',
          severity: 'INFO',
          title: 'Device registration awaiting approval',
          description: `A ${b.platform} device was registered and requires administrator approval before its events are accepted.`,
          dedupeKey: `devreg:${b.deviceId}`,
          officerId: u.officerId,
          deviceId: b.deviceId,
          inputs: { keyFingerprint: key.fingerprint },
        });
      });
      res
        .status(201)
        .json({ deviceId: b.deviceId, status: 'PENDING', keyFingerprint: key.fingerprint });
    }),
  );

  r.get(
    '/mine',
    requirePermission('checkin.perform'),
    h(async (req, res) => {
      const u = authUser(req);
      const { rows } = await ctx.pool.query(
        `SELECT ${cols} FROM devices d JOIN officers o ON o.id = d.officer_id LEFT JOIN device_chain_heads h ON h.device_id = d.id WHERE d.officer_id = $1 ORDER BY d.registered_at DESC`,
        [u.officerId],
      );
      res.json({ items: rows });
    }),
  );

  r.get(
    '/',
    requirePermission('device.view'),
    h(async (req, res) => {
      const q = pageQuery
        .extend({ status: z.enum(['PENDING', 'ACTIVE', 'REVOKED']).optional() })
        .parse(req.query);
      const { limit, offset } = paging(q);
      const args: unknown[] = [];
      const where = [officerScopeSql(authUser(req), 'd.officer_id', args)];
      if (q.status) {
        args.push(q.status);
        where.push(`d.status = $${args.length}`);
      }
      const w = `WHERE ${where.join(' AND ')}`;
      const total = (
        await ctx.pool.query<{ n: number }>(`SELECT count(*)::int n FROM devices d ${w}`, args)
      ).rows[0]!.n;
      const { rows } = await ctx.pool.query(
        `SELECT ${cols} FROM devices d JOIN officers o ON o.id = d.officer_id LEFT JOIN device_chain_heads h ON h.device_id = d.id ${w} ORDER BY d.registered_at DESC LIMIT ${limit} OFFSET ${offset}`,
        args,
      );
      res.json(pageResult(rows, total, q));
    }),
  );

  r.post(
    '/:id/approve',
    requirePermission('device.approve'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const u = authUser(req);
      await withTransaction(ctx.pool, async (c) => {
        const d = (
          await c.query<{ status: string }>('SELECT status FROM devices WHERE id = $1 FOR UPDATE', [
            id,
          ])
        ).rows[0];
        if (!d) throw new AppError(404, 'NOT_FOUND', 'Device not found.');
        if (d.status !== 'PENDING')
          throw new AppError(
            409,
            'CONFLICT',
            `Device is ${d.status}; only PENDING devices can be approved.`,
          );
        await c.query(
          "UPDATE devices SET status = 'ACTIVE', approved_at = now(), approved_by = $2 WHERE id = $1",
          [id, u.id],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'DEVICE_APPROVED',
          targetType: 'device',
          targetId: id,
          requestId: reqId(req),
        });
      });
      res.json({ deviceId: id, status: 'ACTIVE' });
    }),
  );

  r.post(
    '/:id/revoke',
    requirePermission('device.approve'),
    h(async (req, res) => {
      const id = param(req, 'id');
      const u = authUser(req);
      const { reason } = z
        .object({ reason: z.string().min(3).max(200) })
        .strict()
        .parse(req.body);
      await withTransaction(ctx.pool, async (c) => {
        const d = (
          await c.query<{ status: string; officer_id: string }>(
            'SELECT status, officer_id FROM devices WHERE id = $1 FOR UPDATE',
            [id],
          )
        ).rows[0];
        if (!d) throw new AppError(404, 'NOT_FOUND', 'Device not found.');
        if (d.status === 'REVOKED') throw new AppError(409, 'CONFLICT', 'Device already revoked.');
        await c.query(
          "UPDATE devices SET status = 'REVOKED', revoked_at = now(), revoked_by = $2, revocation_reason = $3 WHERE id = $1",
          [id, u.id, reason],
        );
        await c.query(
          "UPDATE refresh_tokens SET revoked_at = now(), revoke_reason = 'DEVICE_REVOKED' WHERE device_id = $1 AND revoked_at IS NULL",
          [id],
        );
        await appendAudit(c, {
          actorUserId: u.id,
          actorRole: u.role,
          action: 'DEVICE_REVOKED',
          targetType: 'device',
          targetId: id,
          requestId: reqId(req),
          details: { reason },
        });
        await raiseFlag(c, ctx.bus, {
          type: 'DEVICE_REVOCATION',
          severity: 'INFO',
          title: 'Device revoked',
          description: `Device revoked: ${reason}`,
          dedupeKey: `devrev:${id}`,
          officerId: d.officer_id,
          deviceId: id,
          inputs: { reason },
        });
      });
      res.json({ deviceId: id, status: 'REVOKED' });
    }),
  );
  return r;
}
