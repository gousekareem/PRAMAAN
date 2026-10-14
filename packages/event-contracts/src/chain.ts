import { computeEventHash, GENESIS_HASH, type SignedEvent } from './event';

export type ChainIssueCode =
  | 'HASH_MISMATCH'
  | 'LINK_MISMATCH'
  | 'SEQUENCE_GAP'
  | 'DUPLICATE_SEQUENCE'
  | 'DUPLICATE_EVENT_ID'
  | 'GENESIS_INVALID'
  | 'DEVICE_MISMATCH'
  | 'ANCHOR_MISMATCH'
  | 'ANCHOR_NOT_COVERED';

export interface ChainIssue {
  code: ChainIssueCode;
  eventId?: string;
  sequence?: number;
  detail: string;
}

export interface ChainAnchor {
  deviceSequenceNumber: number;
  eventHash: string;
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  firstSequence: number | null;
  lastSequence: number | null;
  headHash: string | null;
  issues: ChainIssue[];
}

/**
 * Verifies a (possibly partial) device hash chain.
 *
 * - Every event hash is recomputed from its canonical body.
 * - Consecutive sequence numbers must link via previousEventHash.
 * - Gaps are REPORTED, never repaired. A gap means the link across it cannot be verified.
 * - Sequence 1 must link to GENESIS_HASH.
 * - Optional trusted anchors (e.g. heads previously acknowledged by the server) must match.
 *
 * A chain that verifies without any trusted anchor only proves internal consistency:
 * a fully compromised client can rewrite an unanchored chain from scratch.
 */
export function verifyChain(events: SignedEvent[], anchors: ChainAnchor[] = []): ChainVerification {
  const issues: ChainIssue[] = [];
  const sorted = [...events].sort((a, b) => a.deviceSequenceNumber - b.deviceSequenceNumber);
  const seenIds = new Set<string>();
  const bySeq = new Map<number, SignedEvent>();
  const deviceId = sorted[0]?.deviceId;

  for (const e of sorted) {
    if (e.deviceId !== deviceId) {
      issues.push({
        code: 'DEVICE_MISMATCH',
        eventId: e.eventId,
        sequence: e.deviceSequenceNumber,
        detail: 'Chain contains events from more than one device',
      });
    }
    if (seenIds.has(e.eventId)) {
      issues.push({
        code: 'DUPLICATE_EVENT_ID',
        eventId: e.eventId,
        sequence: e.deviceSequenceNumber,
        detail: 'Event identifier appears more than once',
      });
    }
    seenIds.add(e.eventId);
    if (bySeq.has(e.deviceSequenceNumber)) {
      issues.push({
        code: 'DUPLICATE_SEQUENCE',
        eventId: e.eventId,
        sequence: e.deviceSequenceNumber,
        detail: 'Two events share a sequence number',
      });
      continue;
    }
    bySeq.set(e.deviceSequenceNumber, e);
    const recomputed = computeEventHash(e);
    if (recomputed !== e.eventHash) {
      issues.push({
        code: 'HASH_MISMATCH',
        eventId: e.eventId,
        sequence: e.deviceSequenceNumber,
        detail: `Recomputed hash ${recomputed} differs from stored hash`,
      });
    }
    if (e.deviceSequenceNumber === 1 && e.previousEventHash !== GENESIS_HASH) {
      issues.push({
        code: 'GENESIS_INVALID',
        eventId: e.eventId,
        sequence: 1,
        detail: 'First event does not link to the genesis hash',
      });
    }
  }

  const seqs = [...bySeq.keys()].sort((a, b) => a - b);
  for (let i = 1; i < seqs.length; i++) {
    const prevSeq = seqs[i - 1]!;
    const seq = seqs[i]!;
    const cur = bySeq.get(seq)!;
    if (seq !== prevSeq + 1) {
      issues.push({
        code: 'SEQUENCE_GAP',
        eventId: cur.eventId,
        sequence: seq,
        detail: `Missing sequence numbers ${prevSeq + 1}..${seq - 1}; link not verifiable`,
      });
      continue;
    }
    const prev = bySeq.get(prevSeq)!;
    if (cur.previousEventHash !== prev.eventHash) {
      issues.push({
        code: 'LINK_MISMATCH',
        eventId: cur.eventId,
        sequence: seq,
        detail: `previousEventHash does not equal hash of sequence ${prevSeq}`,
      });
    }
  }

  for (const anchor of anchors) {
    const e = bySeq.get(anchor.deviceSequenceNumber);
    if (!e) {
      issues.push({
        code: 'ANCHOR_NOT_COVERED',
        sequence: anchor.deviceSequenceNumber,
        detail: 'Trusted anchor sequence is not present in the supplied events',
      });
    } else if (e.eventHash !== anchor.eventHash) {
      issues.push({
        code: 'ANCHOR_MISMATCH',
        eventId: e.eventId,
        sequence: anchor.deviceSequenceNumber,
        detail: 'Event hash differs from the trusted anchor',
      });
    }
  }

  const last = seqs.length ? bySeq.get(seqs[seqs.length - 1]!)! : null;
  return {
    ok: issues.filter((i) => i.code !== 'ANCHOR_NOT_COVERED').length === 0,
    checked: sorted.length,
    firstSequence: seqs[0] ?? null,
    lastSequence: last?.deviceSequenceNumber ?? null,
    headHash: last?.eventHash ?? null,
    issues,
  };
}
