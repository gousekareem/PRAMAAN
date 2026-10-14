import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { computeAuditHash, verifyAuditChain, type AuditRecord } from '@pramaan/event-contracts';

export interface AuditInput {
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  evidenceId?: string | null;
  requestId?: string | null;
  details?: Record<string, unknown>;
}

/**
 * Appends a hash-linked audit record. MUST be called inside a transaction; the head row lock
 * serialises audit writes so the chain has no forks or gaps.
 */
export async function appendAudit(client: pg.PoolClient, input: AuditInput): Promise<AuditRecord> {
  const head = await client.query<{ last_sequence: number; last_hash: string }>(
    'SELECT last_sequence, last_hash FROM audit_chain_head WHERE id = 1 FOR UPDATE',
  );
  const h = head.rows[0]!;
  const body = {
    auditId: randomUUID(),
    sequence: h.last_sequence + 1,
    occurredAt: new Date().toISOString(),
    actorUserId: input.actorUserId,
    actorRole: input.actorRole,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    evidenceId: input.evidenceId ?? null,
    requestId: input.requestId ?? null,
    details: input.details ?? {},
    previousHash: h.last_hash,
  };
  const recordHash = computeAuditHash(body);
  await client.query(
    `INSERT INTO audit_events (sequence, audit_id, occurred_at, actor_user_id, actor_role, action, target_type, target_id,
       evidence_id, request_id, details, previous_hash, record_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      body.sequence,
      body.auditId,
      body.occurredAt,
      body.actorUserId,
      body.actorRole,
      body.action,
      body.targetType,
      body.targetId,
      body.evidenceId,
      body.requestId,
      JSON.stringify(body.details),
      body.previousHash,
      recordHash,
    ],
  );
  await client.query(
    'UPDATE audit_chain_head SET last_sequence = $1, last_hash = $2 WHERE id = 1',
    [body.sequence, recordHash],
  );
  return { ...body, recordHash };
}

export interface AuditRow {
  sequence: number;
  audit_id: string;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  evidence_id: string | null;
  request_id: string | null;
  details: Record<string, unknown>;
  previous_hash: string;
  record_hash: string;
}

export function rowToAuditRecord(r: AuditRow): AuditRecord {
  return {
    auditId: r.audit_id,
    sequence: r.sequence,
    occurredAt: r.occurred_at.toISOString(),
    actorUserId: r.actor_user_id,
    actorRole: r.actor_role,
    action: r.action,
    targetType: r.target_type,
    targetId: r.target_id,
    evidenceId: r.evidence_id,
    requestId: r.request_id,
    details: r.details,
    previousHash: r.previous_hash,
    recordHash: r.record_hash,
  };
}

/** Verifies the complete audit chain page by page (bounded memory) and against the head row. */
export async function verifyFullAuditChain(pool: pg.Pool, pageSize = 2000) {
  let after = 0;
  let previous: AuditRecord | null = null;
  let checked = 0;
  const issues: { sequence: number; code: string; detail: string }[] = [];
  for (;;) {
    const { rows } = await pool.query<AuditRow>(
      'SELECT * FROM audit_events WHERE sequence > $1 ORDER BY sequence LIMIT $2',
      [after, pageSize],
    );
    if (!rows.length) break;
    const recs = rows.map(rowToAuditRecord);
    const r = verifyAuditChain(previous ? [previous, ...recs] : recs, previous === null);
    issues.push(...r.issues.filter((i) => !previous || i.sequence !== previous.sequence));
    checked += recs.length;
    previous = recs[recs.length - 1]!;
    after = previous.sequence;
  }
  const head = (
    await pool.query<{ last_sequence: number; last_hash: string }>(
      'SELECT last_sequence, last_hash FROM audit_chain_head WHERE id = 1',
    )
  ).rows[0]!;
  if (
    (previous?.sequence ?? 0) !== head.last_sequence ||
    (previous && previous.recordHash !== head.last_hash)
  ) {
    issues.push({
      sequence: head.last_sequence,
      code: 'HEAD_MISMATCH',
      detail: 'Last audit record does not match the chain head (possible truncation)',
    });
  }
  return {
    ok: issues.length === 0,
    checked,
    headSequence: head.last_sequence,
    headHash: head.last_hash,
    issues,
  };
}
