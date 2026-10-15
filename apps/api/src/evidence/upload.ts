import { createHash } from 'node:crypto';
import type { Request } from 'express';
import busboy from 'busboy';
import type { AppContext } from '../context.js';
import { withTransaction } from '../database/pool.js';
import { AppError } from '../middleware/errors.js';
import type { AuthUser } from '../middleware/auth.js';
import { appendAudit } from '../services/audit.js';
import { raiseFlag } from '../services/flags.js';
import { analyseJpeg } from './screen-analysis.js';

interface Received {
  tempPath: string;
  bytes: number;
  sha256: string;
  head: Buffer;
  truncated: boolean;
  declaredMime: string;
}

function receiveFile(ctx: AppContext, req: Request): Promise<Received> {
  return new Promise((resolve, reject) => {
    let bb: busboy.Busboy;
    try {
      bb = busboy({
        headers: req.headers,
        limits: { files: 1, fields: 0, fileSize: ctx.env.MAX_EVIDENCE_BYTES, parts: 1 },
      });
    } catch {
      reject(
        new AppError(
          400,
          'EVIDENCE_INVALID',
          'Expected multipart/form-data with a single "file" part.',
        ),
      );
      return;
    }
    let got: Promise<Received> | null = null;
    bb.on('file', (name, file, info) => {
      if (name !== 'file' || got) {
        file.resume();
        return;
      }
      const { path, stream } = ctx.storage.createTemp();
      const hash = createHash('sha256');
      let bytes = 0;
      const head: Buffer[] = [];
      let headLen = 0;
      got = new Promise<Received>((res, rej) => {
        file.on('data', (chunk: Buffer) => {
          bytes += chunk.length;
          hash.update(chunk);
          if (headLen < 16) {
            head.push(chunk.subarray(0, 16 - headLen));
            headLen += Math.min(16, chunk.length);
          }
        });
        file.pipe(stream);
        stream.on('error', rej);
        stream.on('finish', () =>
          res({
            tempPath: path,
            bytes,
            sha256: hash.digest('hex'),
            head: Buffer.concat(head),
            truncated: (file as unknown as { truncated?: boolean }).truncated === true,
            declaredMime: info.mimeType,
          }),
        );
      });
    });
    bb.on('error', () =>
      reject(new AppError(400, 'EVIDENCE_INVALID', 'Malformed multipart body.')),
    );
    bb.on('close', () => {
      if (!got) reject(new AppError(400, 'EVIDENCE_INVALID', 'No "file" part was supplied.'));
      else got.then(resolve, reject);
    });
    req.pipe(bb);
  });
}

/**
 * Receives evidence bytes, recomputes SHA-256 on the server and compares with the hash
 * declared in the signed EVIDENCE_CAPTURED event. Mismatching bytes are quarantined (kept),
 * never accepted. A matching hash proves the bytes are unchanged since hashing; it does not
 * prove the photographed scene is genuine.
 */
export async function handleEvidenceUpload(
  ctx: AppContext,
  req: Request,
  user: AuthUser,
  evidenceId: string,
  requestId: string,
) {
  if (!user.permissions.has('checkin.perform') || !user.officerId)
    throw new AppError(403, 'FORBIDDEN', 'Only officer devices upload evidence.');
  const row = (
    await ctx.pool.query<{
      officer_id: string;
      status: string;
      declared_image_sha256: string;
      declared_byte_length: number;
      upload_attempts: number;
      device_status: string;
    }>(
      `SELECT e.officer_id, e.status, e.declared_image_sha256, e.declared_byte_length, e.upload_attempts, d.status AS device_status
       FROM evidence_objects e JOIN devices d ON d.id = e.device_id WHERE e.evidence_id = $1`,
      [evidenceId],
    )
  ).rows[0];
  if (!row || row.officer_id !== user.officerId) {
    req.resume();
    throw new AppError(
      404,
      'EVIDENCE_EVENT_NOT_FOUND',
      'No accepted EVIDENCE_CAPTURED event exists for this evidence ID. Synchronise the ledger event first.',
    );
  }
  if (row.device_status !== 'ACTIVE') {
    req.resume();
    throw new AppError(403, 'DEVICE_REVOKED', 'Device is not active.');
  }
  if (row.status === 'VERIFIED') {
    req.resume();
    return { status: 200, body: { evidenceId, status: 'VERIFIED', alreadyVerified: true } };
  }
  if (row.upload_attempts >= ctx.env.MAX_UPLOAD_ATTEMPTS) {
    req.resume();
    throw new AppError(
      429,
      'EVIDENCE_UPLOAD_LIMIT',
      'Upload attempt limit reached; supervisor review required.',
    );
  }
  const contentLength = Number(req.header('content-length') ?? '0');
  if (contentLength > ctx.env.MAX_EVIDENCE_BYTES + 64 * 1024) {
    req.resume();
    throw new AppError(413, 'EVIDENCE_TOO_LARGE', 'Evidence exceeds the maximum permitted size.');
  }

  const rx = await receiveFile(ctx, req);
  if (rx.truncated) {
    await ctx.storage.discard(rx.tempPath);
    await ctx.pool.query(
      'UPDATE evidence_objects SET upload_attempts = upload_attempts + 1 WHERE evidence_id = $1',
      [evidenceId],
    );
    throw new AppError(413, 'EVIDENCE_TOO_LARGE', 'Evidence exceeds the maximum permitted size.');
  }
  const jpegSignature =
    rx.head.length >= 3 && rx.head[0] === 0xff && rx.head[1] === 0xd8 && rx.head[2] === 0xff;
  const hashOk = rx.sha256 === row.declared_image_sha256 && rx.bytes === row.declared_byte_length;
  const ok = hashOk && jpegSignature;
  const reason = !jpegSignature
    ? 'FILE_SIGNATURE_NOT_JPEG'
    : rx.sha256 !== row.declared_image_sha256
      ? 'IMAGE_HASH_MISMATCH'
      : 'BYTE_LENGTH_MISMATCH';

  let screen: ReturnType<typeof analyseJpeg> | null = null;
  if (ok) screen = analyseJpeg(await (await import('node:fs/promises')).readFile(rx.tempPath));
  const ref = await ctx.storage.promote(rx.tempPath, ok ? 'verified' : 'quarantine');
  const detail = {
    computedSha256: rx.sha256,
    receivedBytes: rx.bytes,
    declaredSha256: row.declared_image_sha256,
    declaredBytes: row.declared_byte_length,
    jpegSignature,
    declaredMime: rx.declaredMime,
    result: ok ? 'MATCH' : reason,
    checkedAt: new Date().toISOString(),
  };

  const outcome = await withTransaction(ctx.pool, async (c) => {
    const cur = (
      await c.query<{ status: string; device_id: string; duty_session_id: string | null }>(
        'SELECT status, device_id, duty_session_id FROM evidence_objects WHERE evidence_id = $1 FOR UPDATE',
        [evidenceId],
      )
    ).rows[0]!;
    if (cur.status === 'VERIFIED') return 'ALREADY';
    await c.query(
      `UPDATE evidence_objects SET status = $2, received_byte_length = $3, computed_image_sha256 = $4, storage_ref = $5,
         verification_detail = $6, screen_risk = $7, upload_attempts = upload_attempts + 1, upload_received_at = now(),
         verified_at = CASE WHEN $2 = 'VERIFIED' THEN now() ELSE verified_at END WHERE evidence_id = $1`,
      [
        evidenceId,
        ok ? 'VERIFIED' : 'QUARANTINED',
        rx.bytes,
        rx.sha256,
        ref,
        JSON.stringify(detail),
        screen ? JSON.stringify(screen) : null,
      ],
    );
    await c.query('UPDATE patrol_logs SET verification_status = $2 WHERE evidence_id = $1', [
      evidenceId,
      ok ? 'EVIDENCE_VERIFIED' : 'EVIDENCE_QUARANTINED',
    ]);
    await appendAudit(c, {
      actorUserId: user.id,
      actorRole: user.role,
      action: ok ? 'EVIDENCE_UPLOAD_VERIFIED' : 'EVIDENCE_UPLOAD_QUARANTINED',
      targetType: 'evidence',
      targetId: evidenceId,
      evidenceId,
      requestId,
      details: detail,
    });
    if (!ok) {
      await raiseFlag(c, ctx.bus, {
        type: 'EVIDENCE_HASH_MISMATCH',
        severity: 'HIGH',
        title: 'Uploaded evidence failed hash verification',
        description: `Server-computed SHA-256 of the received bytes does not match the signed declaration (${reason}). The bytes were quarantined and the original declaration preserved.`,
        dedupeKey: `evhash:${evidenceId}:${rx.sha256}`,
        officerId: user.officerId,
        deviceId: cur.device_id,
        dutySessionId: cur.duty_session_id,
        evidenceId,
        inputs: detail,
      });
    } else if (screen && 'score' in screen && screen.score >= 0.8) {
      await raiseFlag(c, ctx.bus, {
        type: 'SCREEN_RECAPTURE_RISK',
        severity: 'INFO',
        title: 'EXPERIMENTAL: possible screen re-capture pattern',
        description:
          'Strong periodic high-frequency spectral peaks were found. Fabrics, grilles, tiles and halftone prints cause the same pattern; this is a review hint only.',
        dedupeKey: `screen:${evidenceId}`,
        officerId: user.officerId,
        deviceId: cur.device_id,
        dutySessionId: cur.duty_session_id,
        evidenceId,
        inputs: screen as unknown as Record<string, unknown>,
      });
    }
    return ok ? 'VERIFIED' : 'QUARANTINED';
  });
  ctx.bus.publish({
    type: 'evidence-verified',
    evidenceId,
    status: outcome === 'ALREADY' ? 'VERIFIED' : outcome,
    at: new Date().toISOString(),
  });
  if (outcome === 'QUARANTINED') {
    throw new AppError(
      422,
      'EVIDENCE_HASH_MISMATCH',
      'The uploaded bytes do not match the declared SHA-256; the upload was quarantined.',
      { reason, computedSha256: rx.sha256 },
    );
  }
  return {
    status: 200,
    body: {
      evidenceId,
      status: 'VERIFIED',
      sha256: rx.sha256,
      byteLength: rx.bytes,
      alreadyVerified: outcome === 'ALREADY',
    },
  };
}
