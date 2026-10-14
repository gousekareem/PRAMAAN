import { describe, expect, it, vi } from 'vitest';

const opState = { cipherVersion: '4.6.1 community' as string | null, closed: 0 };
vi.mock('@op-engineering/op-sqlite', () => ({
  open: () => ({
    execute: async (sql: string) =>
      sql === 'PRAGMA cipher_version'
        ? {
            rows: opState.cipherVersion ? [{ cipher_version: opState.cipherVersion }] : [],
            rowsAffected: 0,
          }
        : { rows: [], rowsAffected: 0 },
    transaction: async (fn: (tx: unknown) => Promise<void>) =>
      fn({ execute: async () => ({ rows: [], rowsAffected: 0 }) }),
    close: () => {
      opState.closed++;
    },
  }),
}));
import {
  computeManifestHash,
  validateManifest,
  type ManifestLocation,
} from '@pramaan/event-contracts';
import { EvidenceError, EvidenceService, type EvidenceNative } from '../evidence/evidenceService';
import { ObservationProcessor } from '../sensors/observationProcessor';
import { compactLedger } from '../sync/retention';
import { openEncryptedDatabase } from '../storage/opsqlite';
import { DEVICE, DUTY, OFFICER, nodeRandom, setupLedger } from './testkit';

const GRID = Buffer.alloc(256 * 256);
for (let y = 0; y < 256; y++)
  for (let x = 0; x < 256; x++)
    GRID[y * 256 + x] =
      128 + Math.round(90 * Math.sin((2 * Math.PI * x) / 3.3) * Math.sin((2 * Math.PI * y) / 3.3));

function native(overrides: Partial<EvidenceNative> = {}) {
  const discarded: string[] = [];
  const n: EvidenceNative = {
    capture: async () => ({
      tempPath: '/cache/cap.jpg',
      width: 4000,
      height: 3000,
      cameraId: '0',
      captureApi: 'CameraX ImageCapture',
    }),
    seal: async () => ({
      sealedPath: '/files/evidence/abc.enc',
      sha256: 'c'.repeat(64),
      byteLength: 2_400_000,
      width: 4000,
      height: 3000,
      mimeType: 'image/jpeg',
    }),
    lumaThumbnail: async () => ({ width: 256, height: 256, base64: GRID.toString('base64') }),
    discardSealed: async (p) => {
      discarded.push(p);
    },
    ...overrides,
  };
  return { n, discarded };
}

const unavailable: ManifestLocation = {
  availability: 'PERMISSION_DENIED',
  latitude: null,
  longitude: null,
  horizontalAccuracyM: null,
  observedAtDeviceTime: null,
  fixAgeMs: null,
  provider: null,
  speedMps: null,
  mockIndicator: null,
  mockIndicatorSource: null,
};

function ctx(location: ManifestLocation = unavailable) {
  return {
    location: async () => location,
    cellular: async () => ({ availability: 'PERMISSION_DENIED' as const, observations: [] }),
    motion: async () => ({
      stepCounterAvailability: 'AVAILABLE' as const,
      stepsSinceBoot: 4200,
      stepsSinceDutyStart: 300,
      motionState: 'WALKING',
    }),
    posture: async () => ({
      debuggableBuild: false,
      rootIndicators: [],
      developerOptionsEnabled: false,
      adbEnabled: false,
      emulatorIndicators: [],
      appSigningCertSha256: null,
      keyHardwareBacked: true,
    }),
    appVersion: '1.0.0',
  };
}

describe('evidence capture pipeline', () => {
  it('builds a valid manifest bound to the image hash and records it atomically with the signed event', async () => {
    const t = await setupLedger();
    const { n } = native();
    const svc = new EvidenceService(t.db, t.ledger, n, ctx(), t.clock, nodeRandom);
    const r = await svc.captureEvidence({
      dutySessionId: DUTY,
      officerId: OFFICER,
      deviceId: DEVICE,
    });
    expect(validateManifest(r.manifest)).toEqual([]);
    expect(r.manifest.capture.captureProvenance).toBe('IN_APP_CAMERA');
    expect(r.manifest.location.availability).toBe('PERMISSION_DENIED'); // missing data stays missing
    expect(r.manifest.location.latitude).toBeNull();
    expect(r.manifestSha256).toBe(computeManifestHash(r.manifest));
    expect(r.event.payload).toMatchObject({
      imageSha256: 'c'.repeat(64),
      manifestSha256: r.manifestSha256,
    });
    expect(r.manifest.screenRecaptureRisk.score).toBeGreaterThan(0.7); // synthetic periodic thumbnail
    const row = (await t.db.execute('SELECT upload_state, event_id FROM evidence_manifests'))
      .rows[0]!;
    expect(row).toEqual({ upload_state: 'WAITING_FOR_EVENT_ACK', event_id: r.event.eventId });
  });

  it('discards the sealed file and records nothing when validation fails', async () => {
    const t = await setupLedger();
    const { n, discarded } = native({
      seal: async () => ({
        sealedPath: '/files/evidence/x.enc',
        sha256: 'c'.repeat(64),
        byteLength: 20 * 1024 * 1024,
        width: 4000,
        height: 3000,
        mimeType: 'image/jpeg',
      }),
    });
    const svc = new EvidenceService(t.db, t.ledger, n, ctx(), t.clock, nodeRandom);
    await expect(
      svc.captureEvidence({ dutySessionId: DUTY, officerId: OFFICER, deviceId: DEVICE }),
    ).rejects.toBeInstanceOf(EvidenceError);
    expect(discarded).toEqual(['/files/evidence/x.enc']);
    expect((await t.db.execute('SELECT count(*) n FROM ledger_events')).rows[0]!.n).toBe(0);
  });

  it('emits a mock-location indicator event when the platform flags the fix', async () => {
    const t = await setupLedger();
    const svc = new EvidenceService(
      t.db,
      t.ledger,
      native().n,
      ctx({
        availability: 'AVAILABLE',
        latitude: 16.3,
        longitude: 80.45,
        horizontalAccuracyM: 5,
        observedAtDeviceTime: '2026-10-01T08:00:00.000Z',
        fixAgeMs: 100,
        provider: 'gps',
        speedMps: 0,
        mockIndicator: true,
        mockIndicatorSource: 'Location.isMock',
      }),
      t.clock,
      nodeRandom,
    );
    await svc.captureEvidence({ dutySessionId: DUTY, officerId: OFFICER, deviceId: DEVICE });
    const types = (
      await t.db.execute('SELECT event_type FROM ledger_events ORDER BY device_sequence_number')
    ).rows.map((r) => r.event_type);
    expect(types).toEqual(['EVIDENCE_CAPTURED', 'LOCATION_MOCK_INDICATOR']);
  });
});

describe('observation processing (data minimisation + transit)', () => {
  it('sub-samples locations, records step milestones and suspects transit above ~60 km/h', async () => {
    const t = await setupLedger();
    const p = new ObservationProcessor(t.ledger);
    const base = Date.parse('2026-10-01T08:00:00Z');
    const fixes = Array.from({ length: 10 }, (_, i) => ({
      kind: 'LOCATION' as const,
      latitude: 16.3004,
      longitude: 80.4505,
      accuracyM: 8,
      speedMps: 0.5,
      speedAccuracyMps: 0.5,
      provider: 'gps',
      fixWallTime: new Date(base + i * 30_000).toISOString(),
      isMock: false,
      mockSource: 'Location.isMock',
    }));
    await p.process(DUTY, fixes);
    const train = [0, 1, 2].map((i) => ({
      kind: 'LOCATION' as const,
      latitude: 16.31 + i * 0.01,
      longitude: 80.45,
      accuracyM: 10,
      speedMps: 25,
      speedAccuracyMps: 1,
      provider: 'gps',
      fixWallTime: new Date(base + 600_000 + i * 30_000).toISOString(),
      isMock: false,
      mockSource: null,
    }));
    await p.process(DUTY, train);
    await p.process(DUTY, [
      { kind: 'STEPS', stepsSinceBoot: 1000 },
      { kind: 'STEPS', stepsSinceBoot: 1100 },
      { kind: 'STEPS', stepsSinceBoot: 1300 },
      { kind: 'PERMISSION_REVOKED', sensor: 'LOCATION', permission: 'ACCESS_FINE_LOCATION' },
    ]);
    const types = (
      await t.db.execute('SELECT event_type FROM ledger_events ORDER BY device_sequence_number')
    ).rows.map((r) => r.event_type);
    expect(types.filter((x) => x === 'LOCATION_OBSERVED').length).toBeLessThan(10);
    expect(types).toContain('TRANSIT_STATE_SUSPECTED');
    expect(types.filter((x) => x === 'STEP_MILESTONE')).toHaveLength(2);
    expect(types).toContain('SENSOR_PERMISSION_REVOKED');
  });
});

describe('retention and encryption guard', () => {
  it('compacts only acknowledged, verified, old events and keeps the chain verifiable', async () => {
    const t = await setupLedger();
    const loc = {
      latitude: 16.3,
      longitude: 80.45,
      horizontalAccuracyM: 5,
      speedMps: 0,
      speedAccuracyMps: null,
      provider: 'gps',
      fixDeviceTime: '2026-10-01T08:00:00.000Z',
      mockIndicator: null,
      mockIndicatorSource: null,
    };
    for (let i = 0; i < 5; i++)
      await t.ledger.append('LOCATION_OBSERVED', loc, { dutySessionId: DUTY });
    await t.db.execute(
      "UPDATE sync_outbox SET state = 'ACKNOWLEDGED' WHERE device_sequence_number <= 3",
    );
    await t.db.execute("UPDATE ledger_events SET created_at = '2026-01-01T00:00:00.000Z'");
    await t.db.execute("INSERT INTO sync_cursors VALUES ('server_chain_head', ?, 'x')", [
      JSON.stringify({ sequence: 3, eventHash: 'x' }),
    ]);
    const r = await compactLedger(t.db, async () => undefined, new Date('2026-10-01T00:00:00Z'));
    expect(r.compacted).toBe(3);
    expect((await t.db.execute('SELECT count(*) n FROM ledger_events')).rows[0]!.n).toBe(2); // unacknowledged kept
    expect((await t.db.execute('SELECT count(*) n FROM ledger_archive')).rows[0]!.n).toBe(3);
    expect((await t.ledger.verifyLocal()).ok).toBe(true);
  });

  it('refuses invalid keys before touching the native library', async () => {
    await expect(openEncryptedDatabase('x.db', 'not-a-key')).rejects.toThrow(/256-bit/);
  });
  it('refuses to open (and closes) the database when SQLCipher is absent — no plaintext fallback (mocked native layer)', async () => {
    opState.cipherVersion = null;
    await expect(openEncryptedDatabase('x.db', 'a'.repeat(64))).rejects.toThrow(
      /refusing to open an unencrypted database/,
    );
    expect(opState.closed).toBe(1);
    opState.cipherVersion = '4.6.1 community';
    await expect(openEncryptedDatabase('x.db', 'a'.repeat(64))).resolves.toBeDefined();
  });
});
