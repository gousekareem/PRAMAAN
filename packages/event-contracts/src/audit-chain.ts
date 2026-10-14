import { canonicalize } from './canonical';
import { GENESIS_HASH, sha256Hex } from './event';

/** Server-side append-only audit / chain-of-custody record (hash-linked). */
export interface AuditRecordBody {
  auditId: string;
  sequence: number;
  occurredAt: string;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  evidenceId: string | null;
  requestId: string | null;
  details: Record<string, unknown>;
  previousHash: string;
}

export interface AuditRecord extends AuditRecordBody {
  recordHash: string;
}

export function computeAuditHash(r: AuditRecordBody): string {
  return sha256Hex(
    canonicalize({
      auditId: r.auditId,
      sequence: r.sequence,
      occurredAt: r.occurredAt,
      actorUserId: r.actorUserId,
      actorRole: r.actorRole,
      action: r.action,
      targetType: r.targetType,
      targetId: r.targetId,
      evidenceId: r.evidenceId,
      requestId: r.requestId,
      details: r.details,
      previousHash: r.previousHash,
    }),
  );
}

export interface AuditChainResult {
  ok: boolean;
  checked: number;
  issues: {
    sequence: number;
    code: 'HASH_MISMATCH' | 'LINK_MISMATCH' | 'SEQUENCE_GAP';
    detail: string;
  }[];
}

/**
 * Verifies a contiguous run of audit records ordered by sequence. When `fullChain` is true
 * the first record must link to GENESIS_HASH.
 */
export function verifyAuditChain(records: AuditRecord[], fullChain = true): AuditChainResult {
  const issues: AuditChainResult['issues'] = [];
  const sorted = [...records].sort((a, b) => a.sequence - b.sequence);
  sorted.forEach((r, i) => {
    if (computeAuditHash(r) !== r.recordHash) {
      issues.push({
        sequence: r.sequence,
        code: 'HASH_MISMATCH',
        detail: 'Record hash does not match its contents',
      });
    }
    if (i === 0) {
      if (fullChain && r.previousHash !== GENESIS_HASH) {
        issues.push({
          sequence: r.sequence,
          code: 'LINK_MISMATCH',
          detail: 'First record does not link to genesis',
        });
      }
      return;
    }
    const prev = sorted[i - 1]!;
    if (r.sequence !== prev.sequence + 1) {
      issues.push({
        sequence: r.sequence,
        code: 'SEQUENCE_GAP',
        detail: `Missing audit records after ${prev.sequence}`,
      });
    } else if (r.previousHash !== prev.recordHash) {
      issues.push({
        sequence: r.sequence,
        code: 'LINK_MISMATCH',
        detail: 'previousHash does not match prior record',
      });
    }
  });
  return { ok: issues.length === 0, checked: sorted.length, issues };
}
