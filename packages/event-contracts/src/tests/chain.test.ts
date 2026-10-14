import { describe, expect, it } from 'vitest';
import { computeEventHash, verifyChain, GENESIS_HASH } from '../index';
import { makeChain } from './helpers';

describe('event hash chain', () => {
  it('verifies an intact chain', () => {
    const r = verifyChain(makeChain(10));
    expect(r.ok).toBe(true);
    expect(r.checked).toBe(10);
    expect(r.lastSequence).toBe(10);
  });
  it('hash excludes mutable sync fields', () => {
    const [e] = makeChain(1);
    const withSync = { ...e!, sync_state: 'ACKNOWLEDGED', retry_count: 4 } as typeof e;
    expect(computeEventHash(withSync!)).toBe(e!.eventHash);
  });
  it('detects a modified payload', () => {
    const c = makeChain(5);
    c[2]!.payload = { ...c[2]!.payload, latitude: 17 };
    const r = verifyChain(c);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.code)).toContain('HASH_MISMATCH');
  });
  it('detects a rehashed modification through the broken link to the next event', () => {
    const c = makeChain(5);
    c[2]!.payload = { tampered: true };
    c[2]!.eventHash = computeEventHash(c[2]!);
    const r = verifyChain(c);
    expect(r.issues).toEqual([expect.objectContaining({ code: 'LINK_MISMATCH', sequence: 4 })]);
  });
  it('reports (and does not repair) a sequence gap', () => {
    const c = makeChain(6).filter((e) => e.deviceSequenceNumber !== 3);
    const r = verifyChain(c);
    expect(r.issues).toEqual([expect.objectContaining({ code: 'SEQUENCE_GAP', sequence: 4 })]);
    expect(r.checked).toBe(5);
  });
  it('detects duplicates and invalid genesis', () => {
    const c = makeChain(3);
    const bad = [...c, { ...c[1]! }];
    expect(verifyChain(bad).issues.map((i) => i.code)).toEqual(
      expect.arrayContaining(['DUPLICATE_EVENT_ID', 'DUPLICATE_SEQUENCE']),
    );
    const g = makeChain(2, 1, 'f'.repeat(64));
    expect(verifyChain(g).issues.map((i) => i.code)).toContain('GENESIS_INVALID');
  });
  it('detects truncation and full rewrite only against a trusted anchor', () => {
    const original = makeChain(8);
    const anchor = { deviceSequenceNumber: 8, eventHash: original[7]!.eventHash };
    // Truncated: the anchored head is missing.
    const truncated = verifyChain(original.slice(0, 6), [anchor]);
    expect(truncated.issues.map((i) => i.code)).toContain('ANCHOR_NOT_COVERED');
    // Fully rewritten chain is internally consistent ...
    const rewritten = makeChain(8, 1, GENESIS_HASH).map((e) => ({ ...e }));
    rewritten.forEach((e) => (e.payload = { rewritten: true }));
    let prev = GENESIS_HASH;
    for (const e of rewritten) {
      e.previousEventHash = prev;
      e.eventHash = computeEventHash(e);
      prev = e.eventHash;
    }
    expect(verifyChain(rewritten).ok).toBe(true);
    // ... and only the trusted anchor reveals it.
    expect(verifyChain(rewritten, [anchor]).issues.map((i) => i.code)).toContain('ANCHOR_MISMATCH');
  });
});
