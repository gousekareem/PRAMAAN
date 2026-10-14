import { describe, expect, it } from 'vitest';
import {
  eventEnvelopeSchema,
  payloadSchemas,
  syncBatchSchema,
  validatePayload,
  MAX_BATCH_EVENTS,
} from '../index';
import { EVENT_TYPES } from '@pramaan/event-contracts';

const env = {
  schemaVersion: 1,
  eventId: '00000000-0000-4000-8000-000000000001',
  eventType: 'LOCATION_OBSERVED',
  officerId: '1a2b3c4d-1111-4aaa-8bbb-000000000001',
  dutySessionId: null,
  deviceId: '7d1f0f0e-2b7a-4c1e-9a55-3b0f6c1d2e01',
  deviceSequenceNumber: 1,
  deviceWallTime: '2026-10-01T08:00:00.000Z',
  monotonicElapsedMs: 12,
  bootId: 'b1',
  trustedTimeEstimate: null,
  trustedTimeUncertaintyMs: null,
  trustedTimeSource: 'DEVICE_WALL_CLOCK_UNANCHORED',
  payload: {},
  previousEventHash: '0'.repeat(64),
  eventHash: 'a'.repeat(64),
  deviceSignature: null,
};

describe('validation schemas', () => {
  it('has a payload schema for every event type', () => {
    for (const t of EVENT_TYPES) expect(payloadSchemas[t]).toBeDefined();
  });
  it('accepts a valid envelope and rejects unknown fields (strict)', () => {
    expect(eventEnvelopeSchema.safeParse(env).success).toBe(true);
    expect(eventEnvelopeSchema.safeParse({ ...env, serverAccepted: true }).success).toBe(false);
  });
  it('rejects malformed identifiers, hashes and timestamps', () => {
    expect(eventEnvelopeSchema.safeParse({ ...env, eventId: 'not-a-uuid' }).success).toBe(false);
    expect(eventEnvelopeSchema.safeParse({ ...env, eventHash: 'ABC' }).success).toBe(false);
    expect(eventEnvelopeSchema.safeParse({ ...env, deviceWallTime: 'yesterday' }).success).toBe(
      false,
    );
    expect(eventEnvelopeSchema.safeParse({ ...env, deviceSequenceNumber: 0 }).success).toBe(false);
  });
  it('rejects malformed GPS coordinates', () => {
    const p = {
      latitude: 91,
      longitude: 80,
      horizontalAccuracyM: 5,
      speedMps: null,
      speedAccuracyMps: null,
      provider: 'gps',
      fixDeviceTime: env.deviceWallTime,
      mockIndicator: null,
      mockIndicatorSource: null,
    };
    expect(validatePayload('LOCATION_OBSERVED', p).ok).toBe(false);
    expect(validatePayload('LOCATION_OBSERVED', { ...p, latitude: 16.3 }).ok).toBe(true);
    expect(
      validatePayload('LOCATION_OBSERVED', { ...p, latitude: 16.3, longitude: Number.NaN }).ok,
    ).toBe(false);
  });
  it('enforces batch bounds', () => {
    const b = {
      batchId: env.eventId,
      schemaVersion: 1,
      deviceId: env.deviceId,
      events: [] as unknown[],
    };
    expect(syncBatchSchema.safeParse(b).success).toBe(false);
    b.events = new Array(MAX_BATCH_EVENTS + 1).fill({});
    expect(syncBatchSchema.safeParse(b).success).toBe(false);
  });
});
