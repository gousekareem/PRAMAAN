import { randomUUID, type KeyObject } from 'node:crypto';
import type pg from 'pg';
import {
  canonicalize,
  computeEventHash,
  computeManifestHash,
  GENESIS_HASH,
  serverTimestampPlausibility,
  sha256Hex,
  type SignedEvent,
} from '@pramaan/event-contracts';
import {
  eventEnvelopeSchema,
  isSupportedSchemaVersion,
  syncBatchSchema,
  validatePayload,
} from '@pramaan/validation';
import type { AppContext } from '../context.js';
import { AppError } from '../middleware/errors.js';
import type { AuthUser } from '../middleware/auth.js';
import { parseDevicePublicKey, verifyEventSignature } from '../security/device-keys.js';
import { appendAudit } from '../services/audit.js';
import { raiseFlag } from '../services/flags.js';
import { deriveFromEvent } from './derive.js';

export type EventResultStatus = 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT';

export type RejectionCode =
  | 'INVALID_EVENT'
  | 'UNSUPPORTED_SCHEMA_VERSION'
  | 'DEVICE_MISMATCH'
  | 'OFFICER_MISMATCH'
  | 'EVENT_HASH_MISMATCH'
  | 'INVALID_SIGNATURE'
  | 'INVALID_PAYLOAD'
  | 'INVALID_MANIFEST'
  | 'CHAIN_LINK_MISMATCH'
  | 'DUTY_SESSION_INVALID'
  | 'DUTY_SESSION_EXPIRED'
  | 'DUPLICATE_IN_BATCH'
  | 'CONFLICTING_DUPLICATE'
  | 'SEQUENCE_CONFLICT';

export interface EventResult {
  eventId: string | null;
  sequence: number | null;
  status: EventResultStatus;
  code?: RejectionCode;
  detail?: string;
  /** Rejections are terminal for that exact event content; the device must keep it locally. */
  retryable: false;
  chainLinkStatus?: 'GENESIS' | 'LINKED' | 'GAP_BEFORE';
}

export interface BatchResponse {
  batchId: string;
  replayed: boolean;
  serverReceivedAt: string;
  serverTime: string;
  results: EventResult[];
  chainHead: { sequence: number; eventHash: string } | null;
  counts: { accepted: number; duplicate: number; rejected: number; conflict: number };
}

interface DeviceRow {
  id: string;
  officer_id: string;
  status: 'PENDING' | 'ACTIVE' | 'REVOKED';
  public_key_spki: string;
}

/**
 * Batch ingestion semantics (documented in docs/api-reference.md#sync):
 *  1. The batch is validated structurally; schema errors reject the whole batch (400/422).
 *  2. batchId is an idempotency key: an identical replay returns the stored response; reuse
 *     with different content returns 409.
 *  3. Ingestion for one device is serialised with a row lock on the device.
 *  4. Each event is evaluated independently inside a SAVEPOINT and gets its own result.
 *     Accepted events, rejections (quarantined) and conflicts are committed atomically together.
 *  5. Any unexpected server error rolls back the WHOLE batch; nothing is acknowledged, and
 *     the device retries the same batch later.
 */
export async function ingestBatch(
  ctx: AppContext,
  user: AuthUser,
  raw: unknown,
  requestId: string,
): Promise<{ status: number; body: BatchResponse }> {
  const receivedAt = new Date();
  const batch = syncBatchSchema.parse(raw);
  if (!isSupportedSchemaVersion(batch.schemaVersion)) {
    throw new AppError(
      422,
      'UNSUPPORTED_SCHEMA_VERSION',
      `Schema version ${batch.schemaVersion} is not supported.`,
    );
  }
  if (user.role !== 'OFFICER' || !user.officerId)
    throw new AppError(403, 'FORBIDDEN', 'Only officer device sessions may synchronise.');

  const requestSha = sha256Hex(canonicalize(batch));
  const client = await ctx.pool.connect();
  try {
    await client.query('BEGIN');
    const dev = (
      await client.query<DeviceRow>(
        'SELECT id, officer_id, status, public_key_spki FROM devices WHERE id = $1 FOR UPDATE',
        [batch.deviceId],
      )
    ).rows[0];
    if (!dev || dev.officer_id !== user.officerId)
      throw new AppError(403, 'DEVICE_NOT_REGISTERED', 'Device is not registered to this officer.');
    if (dev.status === 'REVOKED')
      throw new AppError(403, 'DEVICE_REVOKED', 'Device registration has been revoked.');
    if (dev.status !== 'ACTIVE')
      throw new AppError(403, 'DEVICE_NOT_APPROVED', 'Device registration is awaiting approval.');

    const existing = (
      await client.query<{ request_sha256: string; response_json: BatchResponse | null }>(
        'SELECT request_sha256, response_json FROM sync_batches WHERE batch_id = $1',
        [batch.batchId],
      )
    ).rows[0];
    if (existing) {
      await client.query('ROLLBACK');
      if (existing.request_sha256 !== requestSha)
        throw new AppError(
          409,
          'IDEMPOTENCY_KEY_REUSED',
          'batchId was already used for different content.',
        );
      return { status: 200, body: { ...existing.response_json!, replayed: true } };
    }
    await client.query(
      'INSERT INTO sync_batches (batch_id, device_id, request_sha256, received_at, event_count, request_id) VALUES ($1,$2,$3,$4,$5,$6)',
      [batch.batchId, dev.id, requestSha, receivedAt, batch.events.length, requestId],
    );

    const key = parseDevicePublicKey(dev.public_key_spki);
    if (!key) throw new AppError(500, 'INTERNAL_ERROR', 'Stored device key is unusable.');

    // Sort by sequence so that links inside one batch can be verified in order.
    const ordered = batch.events
      .map((e, i) => ({
        e,
        i,
        seq:
          typeof (e as { deviceSequenceNumber?: unknown })?.deviceSequenceNumber === 'number'
            ? (e as { deviceSequenceNumber: number }).deviceSequenceNumber
            : Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => a.seq - b.seq || a.i - b.i);
    const seenInBatch = new Set<string>();
    const results: EventResult[] = [];
    for (const { e } of ordered) {
      await client.query('SAVEPOINT ev');
      try {
        const r = await ingestOne(
          ctx,
          client,
          dev,
          key.key,
          e,
          seenInBatch,
          batch.batchId,
          requestId,
          receivedAt,
        );
        await client.query('RELEASE SAVEPOINT ev');
        results.push(r);
      } catch (err) {
        await client.query('ROLLBACK TO SAVEPOINT ev');
        throw err;
      }
    }

    const head = (
      await client.query<{ last_sequence: number; last_event_hash: string }>(
        'SELECT last_sequence, last_event_hash FROM device_chain_heads WHERE device_id = $1',
        [dev.id],
      )
    ).rows[0];
    const counts = {
      accepted: results.filter((r) => r.status === 'ACCEPTED').length,
      duplicate: results.filter((r) => r.status === 'DUPLICATE').length,
      rejected: results.filter((r) => r.status === 'REJECTED').length,
      conflict: results.filter((r) => r.status === 'CONFLICT').length,
    };
    const body: BatchResponse = {
      batchId: batch.batchId,
      replayed: false,
      serverReceivedAt: receivedAt.toISOString(),
      serverTime: new Date().toISOString(),
      results,
      chainHead: head ? { sequence: head.last_sequence, eventHash: head.last_event_hash } : null,
      counts,
    };
    await client.query(
      `UPDATE sync_batches SET processed_at = now(), accepted_count = $2, duplicate_count = $3, rejected_count = $4, response_json = $5 WHERE batch_id = $1`,
      [
        batch.batchId,
        counts.accepted,
        counts.duplicate,
        counts.rejected + counts.conflict,
        JSON.stringify(body),
      ],
    );
    await client.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [dev.id]);
    await appendAudit(client, {
      actorUserId: user.id,
      actorRole: user.role,
      action: 'SYNC_BATCH_INGESTED',
      targetType: 'sync_batch',
      targetId: batch.batchId,
      requestId,
      details: { deviceId: dev.id, ...counts, requestSha256: requestSha },
    });
    await client.query('COMMIT');
    ctx.bus.publish({
      type: 'batch-ingested',
      deviceId: dev.id,
      officerId: dev.officer_id,
      accepted: counts.accepted,
      at: body.serverTime,
    });
    return { status: 200, body };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function reject(
  c: pg.PoolClient,
  dev: DeviceRow,
  raw: unknown,
  batchId: string,
  requestId: string,
  code: RejectionCode,
  detail: string,
  eventId: string | null,
  sequence: number | null,
): Promise<EventResult> {
  let submitted: unknown = null;
  let submittedSha = sha256Hex('unserialisable');
  try {
    const text = JSON.stringify(raw);
    submittedSha = sha256Hex(text);
    submitted = text.length <= 256 * 1024 ? raw : { truncated: true, length: text.length };
  } catch {
    /* keep defaults */
  }
  await c.query(
    `INSERT INTO ingestion_rejections (id, batch_id, device_id, event_id_text, device_sequence_number, reason_code, detail, submitted_sha256, submitted_event, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      batchId,
      dev.id,
      eventId?.slice(0, 64) ?? null,
      sequence,
      code,
      detail.slice(0, 500),
      submittedSha,
      JSON.stringify(submitted),
      requestId,
    ],
  );
  return { eventId, sequence, status: 'REJECTED', code, detail, retryable: false };
}

async function ingestOne(
  ctx: AppContext,
  c: pg.PoolClient,
  dev: DeviceRow,
  key: KeyObject,
  raw: unknown,
  seenInBatch: Set<string>,
  batchId: string,
  requestId: string,
  receivedAt: Date,
): Promise<EventResult> {
  const parsed = eventEnvelopeSchema.safeParse(raw);
  const rawObj = (raw ?? {}) as { eventId?: unknown; deviceSequenceNumber?: unknown };
  const rawId = typeof rawObj.eventId === 'string' ? rawObj.eventId : null;
  const rawSeq =
    typeof rawObj.deviceSequenceNumber === 'number' ? rawObj.deviceSequenceNumber : null;
  if (!parsed.success) {
    const detail = parsed.error.issues
      .slice(0, 5)
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    return reject(c, dev, raw, batchId, requestId, 'INVALID_EVENT', detail, rawId, rawSeq);
  }
  const e = parsed.data as SignedEvent;
  const seq = e.deviceSequenceNumber;
  if (seenInBatch.has(e.eventId))
    return reject(
      c,
      dev,
      raw,
      batchId,
      requestId,
      'DUPLICATE_IN_BATCH',
      'Event appears twice in one batch',
      e.eventId,
      seq,
    );
  seenInBatch.add(e.eventId);
  if (!isSupportedSchemaVersion(e.schemaVersion))
    return reject(
      c,
      dev,
      raw,
      batchId,
      requestId,
      'UNSUPPORTED_SCHEMA_VERSION',
      `schemaVersion ${e.schemaVersion}`,
      e.eventId,
      seq,
    );
  if (e.deviceId !== dev.id)
    return reject(
      c,
      dev,
      raw,
      batchId,
      requestId,
      'DEVICE_MISMATCH',
      'Event deviceId differs from the batch device',
      e.eventId,
      seq,
    );
  if (e.officerId !== dev.officer_id)
    return reject(
      c,
      dev,
      raw,
      batchId,
      requestId,
      'OFFICER_MISMATCH',
      'Event officer is not the registered officer of this device',
      e.eventId,
      seq,
    );

  // Idempotency: same event_id already stored.
  const prior = (
    await c.query<{ event_hash: string; device_sequence_number: number }>(
      'SELECT event_hash, device_sequence_number FROM device_events WHERE event_id = $1',
      [e.eventId],
    )
  ).rows[0];
  const recomputed = computeEventHash(e);
  if (prior) {
    if (prior.event_hash === e.eventHash && recomputed === e.eventHash) {
      return { eventId: e.eventId, sequence: seq, status: 'DUPLICATE', retryable: false };
    }
    await c.query(
      `INSERT INTO ingestion_conflicts (id, device_id, event_id, device_sequence_number, existing_event_hash, conflicting_event_hash, conflicting_event, batch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        dev.id,
        e.eventId,
        seq,
        prior.event_hash,
        e.eventHash,
        JSON.stringify(raw),
        batchId,
      ],
    );
    await raiseFlag(c, ctx.bus, {
      type: 'EVENT_CONFLICT',
      severity: 'HIGH',
      title: 'Conflicting duplicate event',
      description:
        'An already accepted event identifier was re-submitted with different content. Both versions are preserved.',
      dedupeKey: `conflict:${e.eventId}:${e.eventHash}`,
      officerId: dev.officer_id,
      deviceId: dev.id,
      eventId: e.eventId,
      inputs: { existingHash: prior.event_hash, submittedHash: e.eventHash },
    });
    return {
      eventId: e.eventId,
      sequence: seq,
      status: 'CONFLICT',
      code: 'CONFLICTING_DUPLICATE',
      detail: 'Event ID already accepted with different content',
      retryable: false,
    };
  }

  if (recomputed !== e.eventHash) {
    await raiseFlag(c, ctx.bus, {
      type: 'CHAIN_LINK_MISMATCH',
      severity: 'HIGH',
      title: 'Event failed integrity verification',
      description: 'The submitted event hash does not match the canonical event content.',
      dedupeKey: `hash:${e.eventId}:${e.eventHash}`,
      officerId: dev.officer_id,
      deviceId: dev.id,
      eventId: e.eventId,
      inputs: { declared: e.eventHash, recomputed },
    });
    return reject(
      c,
      dev,
      raw,
      batchId,
      requestId,
      'EVENT_HASH_MISMATCH',
      'Declared hash does not match canonical content',
      e.eventId,
      seq,
    );
  }
  if (!verifyEventSignature(key, e.eventHash, e.deviceSignature)) {
    await raiseFlag(c, ctx.bus, {
      type: 'INVALID_DEVICE_SIGNATURE',
      severity: 'HIGH',
      title: 'Invalid device signature',
      description: 'The event signature does not verify against the registered device public key.',
      dedupeKey: `sig:${e.eventId}:${e.eventHash}`,
      officerId: dev.officer_id,
      deviceId: dev.id,
      eventId: e.eventId,
      inputs: { eventHash: e.eventHash },
    });
    return reject(
      c,
      dev,
      raw,
      batchId,
      requestId,
      'INVALID_SIGNATURE',
      'Signature does not verify with the registered device key',
      e.eventId,
      seq,
    );
  }
  const pv = validatePayload(e.eventType, e.payload);
  if (!pv.ok)
    return reject(
      c,
      dev,
      raw,
      batchId,
      requestId,
      'INVALID_PAYLOAD',
      pv.issues.join('; '),
      e.eventId,
      seq,
    );

  if (e.eventType === 'EVIDENCE_CAPTURED') {
    const p = e.payload as {
      evidenceId: string;
      imageSha256: string;
      manifestSha256: string;
      manifest: Parameters<typeof computeManifestHash>[0];
    };
    const m = p.manifest;
    const problems: string[] = [];
    if (computeManifestHash(m) !== p.manifestSha256) problems.push('manifest hash mismatch');
    if (m.image.sha256 !== p.imageSha256) problems.push('image hash differs from manifest');
    if (m.evidenceId !== p.evidenceId) problems.push('evidence id differs from manifest');
    if (
      m.deviceId !== e.deviceId ||
      m.officerId !== e.officerId ||
      m.dutySessionId !== e.dutySessionId
    )
      problems.push('manifest context differs from event context');
    const used = await c.query('SELECT 1 FROM evidence_objects WHERE evidence_id = $1', [
      p.evidenceId,
    ]);
    if (used.rowCount) problems.push('evidence id already declared by another event');
    if (problems.length)
      return reject(
        c,
        dev,
        raw,
        batchId,
        requestId,
        'INVALID_MANIFEST',
        problems.join('; '),
        e.eventId,
        seq,
      );
  }

  // Sequence slot already used by a different event id.
  const slot = (
    await c.query<{ event_id: string; event_hash: string }>(
      'SELECT event_id, event_hash FROM device_events WHERE device_id = $1 AND device_sequence_number = $2',
      [dev.id, seq],
    )
  ).rows[0];
  if (slot) {
    await c.query(
      `INSERT INTO ingestion_conflicts (id, device_id, event_id, device_sequence_number, existing_event_hash, conflicting_event_hash, conflicting_event, batch_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        randomUUID(),
        dev.id,
        e.eventId,
        seq,
        slot.event_hash,
        e.eventHash,
        JSON.stringify(raw),
        batchId,
      ],
    );
    await raiseFlag(c, ctx.bus, {
      type: 'EVENT_CONFLICT',
      severity: 'HIGH',
      title: 'Sequence number reused',
      description: `Device sequence ${seq} was already used by another accepted event (possible ledger fork or reinstall without key rotation).`,
      dedupeKey: `seqconflict:${dev.id}:${seq}:${e.eventHash}`,
      officerId: dev.officer_id,
      deviceId: dev.id,
      eventId: e.eventId,
      inputs: { existingEventId: slot.event_id, sequence: seq },
    });
    return {
      eventId: e.eventId,
      sequence: seq,
      status: 'CONFLICT',
      code: 'SEQUENCE_CONFLICT',
      detail: 'Sequence number already used by another event',
      retryable: false,
    };
  }

  // Duty session context.
  let dutyId: string | null = null;
  if (e.dutySessionId) {
    const d = (
      await c.query<{ officer_id: string; status: string; planned_start: Date; planned_end: Date }>(
        'SELECT officer_id, status, planned_start, planned_end FROM duty_sessions WHERE id = $1',
        [e.dutySessionId],
      )
    ).rows[0];
    if (!d || d.officer_id !== dev.officer_id)
      return reject(
        c,
        dev,
        raw,
        batchId,
        requestId,
        'DUTY_SESSION_INVALID',
        'Unknown duty session or not assigned to this officer',
        e.eventId,
        seq,
      );
    if (d.status === 'CANCELLED')
      return reject(
        c,
        dev,
        raw,
        batchId,
        requestId,
        'DUTY_SESSION_EXPIRED',
        'Duty session was cancelled',
        e.eventId,
        seq,
      );
    const t = Date.parse(e.trustedTimeEstimate ?? e.deviceWallTime);
    const grace = ctx.env.DUTY_GRACE_MINUTES * 60_000;
    if (t < d.planned_start.getTime() - grace || t > d.planned_end.getTime() + grace) {
      return reject(
        c,
        dev,
        raw,
        batchId,
        requestId,
        'DUTY_SESSION_EXPIRED',
        'Event time is outside the duty window (including grace period)',
        e.eventId,
        seq,
      );
    }
    dutyId = e.dutySessionId;
  }

  // Hash-chain link verification against stored neighbours.
  let chainLinkStatus: 'GENESIS' | 'LINKED' | 'GAP_BEFORE';
  if (seq === 1) {
    if (e.previousEventHash !== GENESIS_HASH)
      return reject(
        c,
        dev,
        raw,
        batchId,
        requestId,
        'CHAIN_LINK_MISMATCH',
        'First event must link to the genesis hash',
        e.eventId,
        seq,
      );
    chainLinkStatus = 'GENESIS';
  } else {
    const prev = (
      await c.query<{ event_hash: string }>(
        'SELECT event_hash FROM device_events WHERE device_id = $1 AND device_sequence_number = $2',
        [dev.id, seq - 1],
      )
    ).rows[0];
    if (prev) {
      if (prev.event_hash !== e.previousEventHash) {
        await raiseFlag(c, ctx.bus, {
          type: 'CHAIN_LINK_MISMATCH',
          severity: 'HIGH',
          title: 'Ledger link mismatch',
          description: `Event ${seq} does not link to the stored event ${seq - 1}; the local ledger may have been rewritten.`,
          dedupeKey: `link:${dev.id}:${seq}:${e.eventHash}`,
          officerId: dev.officer_id,
          deviceId: dev.id,
          eventId: e.eventId,
          inputs: { expectedPrevious: prev.event_hash, declaredPrevious: e.previousEventHash },
        });
        return reject(
          c,
          dev,
          raw,
          batchId,
          requestId,
          'CHAIN_LINK_MISMATCH',
          `previousEventHash does not match stored sequence ${seq - 1}`,
          e.eventId,
          seq,
        );
      }
      chainLinkStatus = 'LINKED';
    } else {
      chainLinkStatus = 'GAP_BEFORE';
    }
  }
  const next = (
    await c.query<{ previous_event_hash: string; event_id: string }>(
      'SELECT previous_event_hash, event_id FROM device_events WHERE device_id = $1 AND device_sequence_number = $2',
      [dev.id, seq + 1],
    )
  ).rows[0];
  if (next && next.previous_event_hash !== e.eventHash) {
    return reject(
      c,
      dev,
      raw,
      batchId,
      requestId,
      'CHAIN_LINK_MISMATCH',
      `Stored sequence ${seq + 1} does not link to this event`,
      e.eventId,
      seq,
    );
  }

  await c.query(
    `INSERT INTO device_events (event_id, device_id, officer_id, duty_session_id, device_sequence_number, event_type, schema_version,
        device_wall_time, monotonic_elapsed_ms, boot_id, trusted_time_estimate, trusted_time_uncertainty_ms, trusted_time_source, payload,
        previous_event_hash, event_hash, device_signature, signature_status, chain_link_status, envelope, batch_id, request_id, server_received_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'VALID',$18,$19,$20,$21,$22)`,
    [
      e.eventId,
      dev.id,
      dev.officer_id,
      dutyId,
      seq,
      e.eventType,
      e.schemaVersion,
      e.deviceWallTime,
      e.monotonicElapsedMs,
      e.bootId,
      e.trustedTimeEstimate,
      e.trustedTimeUncertaintyMs,
      e.trustedTimeSource,
      JSON.stringify(e.payload),
      e.previousEventHash,
      e.eventHash,
      e.deviceSignature,
      chainLinkStatus,
      JSON.stringify(e),
      batchId,
      requestId,
      receivedAt,
    ],
  );
  await c.query(
    `INSERT INTO device_chain_heads (device_id, last_sequence, last_event_hash) VALUES ($1,$2,$3)
     ON CONFLICT (device_id) DO UPDATE SET last_sequence = EXCLUDED.last_sequence, last_event_hash = EXCLUDED.last_event_hash, updated_at = now()
     WHERE device_chain_heads.last_sequence < EXCLUDED.last_sequence`,
    [dev.id, seq, e.eventHash],
  );

  if (chainLinkStatus === 'GAP_BEFORE') {
    await raiseFlag(c, ctx.bus, {
      type: 'SEQUENCE_GAP',
      severity: 'MEDIUM',
      title: 'Ledger sequence gap',
      description: `Event ${seq} arrived without its predecessor ${seq - 1}. The gap is reported, not repaired; it may be filled by a later upload.`,
      dedupeKey: `gap:${dev.id}:${seq}`,
      officerId: dev.officer_id,
      deviceId: dev.id,
      dutySessionId: dutyId,
      eventId: e.eventId,
      inputs: { sequence: seq },
    });
  }
  for (const a of serverTimestampPlausibility(
    e.deviceWallTime,
    receivedAt,
    ctx.env.FUTURE_SKEW_TOLERANCE_MS,
  )) {
    await raiseFlag(c, ctx.bus, {
      type: 'CLOCK_ANOMALY',
      severity: 'MEDIUM',
      title: 'Device timestamp later than server receipt',
      description: a.detail,
      dedupeKey: `future:${e.eventId}`,
      officerId: dev.officer_id,
      deviceId: dev.id,
      dutySessionId: dutyId,
      eventId: e.eventId,
      inputs: {
        deviceWallTime: e.deviceWallTime,
        serverReceivedAt: receivedAt.toISOString(),
        deltaMs: a.deltaMs,
      },
    });
  }
  await deriveFromEvent(ctx, c, e, dutyId, receivedAt);
  return {
    eventId: e.eventId,
    sequence: seq,
    status: 'ACCEPTED',
    retryable: false,
    chainLinkStatus,
  };
}
