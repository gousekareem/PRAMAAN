import { computeEventHash, GENESIS_HASH, type EventBody, type SignedEvent } from '../index';

export const DEVICE = '7d1f0f0e-2b7a-4c1e-9a55-3b0f6c1d2e01';
export const OFFICER = '1a2b3c4d-1111-4aaa-8bbb-000000000001';
export const DUTY = '9e8d7c6b-2222-4ccc-9ddd-000000000002';

export function makeChain(n: number, start = 1, prev = GENESIS_HASH): SignedEvent[] {
  const out: SignedEvent[] = [];
  let previous = prev;
  for (let i = 0; i < n; i++) {
    const seq = start + i;
    const body: EventBody = {
      schemaVersion: 1,
      eventId: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
      eventType: 'LOCATION_OBSERVED',
      officerId: OFFICER,
      dutySessionId: DUTY,
      deviceId: DEVICE,
      deviceSequenceNumber: seq,
      deviceWallTime: new Date(Date.UTC(2026, 9, 1, 8, 0, seq)).toISOString(),
      monotonicElapsedMs: 1_000_000 + seq * 1000,
      bootId: 'boot-1',
      trustedTimeEstimate: null,
      trustedTimeUncertaintyMs: null,
      trustedTimeSource: 'DEVICE_WALL_CLOCK_UNANCHORED',
      payload: { latitude: 16.3008 + seq / 1e5, longitude: 80.4428, horizontalAccuracyM: 8.5 },
      previousEventHash: previous,
    };
    const eventHash = computeEventHash(body);
    out.push({ ...body, eventHash, deviceSignature: null });
    previous = eventHash;
  }
  return out;
}
