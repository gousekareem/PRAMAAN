import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verify } from 'node:crypto';
import { computeEventHash, eventSignatureMessage, GENESIS_HASH } from '@pramaan/event-contracts';
import { LedgerService } from '../ledger/ledger';
import { runLocalMigrations } from '../storage/migrations';
import { DUTY, memoryDb, nodeRandom, setupLedger, FakeClock } from './testkit';

const loc = (lat = 16.3004) => ({
  latitude: lat,
  longitude: 80.4505,
  horizontalAccuracyM: 6,
  speedMps: 0,
  speedAccuracyMps: 0.5,
  provider: 'gps',
  fixDeviceTime: '2026-10-01T08:00:00.000Z',
  mockIndicator: false,
  mockIndicatorSource: 'Location.isMock',
});

describe('local ledger', () => {
  it('creates canonical, hash-linked, signed events with a persistent outbox entry', async () => {
    const { ledger, db, publicKey } = await setupLedger();
    const e1 = await ledger.append(
      'DUTY_SESSION_STARTED',
      { assignedZoneIds: [], startedVia: 'APP' },
      { dutySessionId: DUTY },
    );
    const e2 = await ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    expect(e1.deviceSequenceNumber).toBe(1);
    expect(e1.previousEventHash).toBe(GENESIS_HASH);
    expect(e2.previousEventHash).toBe(e1.eventHash);
    expect(computeEventHash(e2)).toBe(e2.eventHash);
    expect(
      verify(
        'sha256',
        Buffer.from(eventSignatureMessage(e2.eventHash)),
        publicKey,
        Buffer.from(e2.deviceSignature!, 'base64'),
      ),
    ).toBe(true);
    const outbox = (
      await db.execute('SELECT state FROM sync_outbox ORDER BY device_sequence_number')
    ).rows.map((r) => r.state);
    expect(outbox).toEqual(['PENDING', 'PENDING']);
    expect((await ledger.verifyLocal()).ok).toBe(true);
  });

  it('never resets sequence numbers across process restarts', async () => {
    const file = join(mkdtempSync(join(tmpdir(), 'pramaan-')), 'ledger.db');
    const a = await setupLedger(file);
    await a.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    await a.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    await a.db.close();
    const db2 = memoryDb(file);
    await runLocalMigrations(db2);
    const l2 = new LedgerService(db2, new FakeClock(), a.signer, nodeRandom);
    await l2.initialise(
      '7d1f0f0e-2b7a-4c1e-9a55-3b0f6c1d2e01',
      '1a2b3c4d-1111-4aaa-8bbb-000000000001',
    );
    const e3 = await l2.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    expect(e3.deviceSequenceNumber).toBe(3);
    expect((await l2.verifyLocal()).ok).toBe(true);
    await expect(l2.initialise('00000000-0000-4000-8000-000000000000', 'x')).rejects.toThrow(
      /different device/,
    );
  });

  it('rolls back the whole append when a companion statement fails (no orphan events)', async () => {
    const { ledger, db } = await setupLedger();
    await expect(
      ledger.append('LOCATION_OBSERVED', loc(), {
        dutySessionId: DUTY,
        alsoInTx: async () => {
          throw new Error('disk full');
        },
      }),
    ).rejects.toThrow('disk full');
    expect((await db.execute('SELECT count(*) n FROM ledger_events')).rows[0]!.n).toBe(0);
    expect((await ledger.state())!.next_sequence).toBe(1);
  });

  it('rejects invalid payloads before they reach the ledger', async () => {
    const { ledger } = await setupLedger();
    await expect(ledger.append('LOCATION_OBSERVED', { ...loc(), latitude: 200 })).rejects.toThrow(
      /Invalid LOCATION_OBSERVED/,
    );
  });

  it('serialises concurrent appends without forking the chain', async () => {
    const { ledger } = await setupLedger();
    await Promise.all(
      Array.from({ length: 20 }, () =>
        ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY }),
      ),
    );
    const v = await ledger.verifyLocal();
    expect(v.ok).toBe(true);
    expect(v.checked).toBe(20);
  });

  it('appends CLOCK_ANOMALY_DETECTED when the wall clock is rolled back offline, preserving original times', async () => {
    const { ledger, clock, db } = await setupLedger();
    await ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    clock.mono += 60_000;
    clock.wall -= 2 * 3600_000; // user sets the clock back two hours
    const e = await ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    const types = (
      await db.execute('SELECT event_type FROM ledger_events ORDER BY device_sequence_number')
    ).rows.map((r) => r.event_type);
    expect(types).toEqual(['LOCATION_OBSERVED', 'LOCATION_OBSERVED', 'CLOCK_ANOMALY_DETECTED']);
    expect(e.deviceWallTime).toBe(new Date(clock.wall).toISOString());
  });

  it('uses the server time anchor + monotonic clock for trusted-time estimates (offline 8 h)', async () => {
    const { ledger, clock } = await setupLedger();
    await ledger.recordTimeAnchor(
      '2026-10-01T08:00:00.000Z',
      clock.mono,
      clock.bootId,
      new Date(clock.wall).toISOString(),
      300,
    );
    clock.advance(8 * 3600_000);
    clock.wall += 90_000; // device clock drifts/is changed by 90 s
    const e = await ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    expect(e.trustedTimeSource).toBe('SERVER_ANCHOR_MONOTONIC');
    expect(e.trustedTimeEstimate).toBe('2026-10-01T16:00:00.000Z');
    expect(e.trustedTimeUncertaintyMs).toBeGreaterThan(2_000);
    clock.bootId = 'boot-B'; // after a reboot the anchor no longer applies
    clock.mono = 5_000;
    const after = await ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    expect(after.trustedTimeSource).toBe('DEVICE_WALL_CLOCK_UNANCHORED');
    expect(after.trustedTimeEstimate).toBeNull();
  });

  it('detects local tampering of a stored envelope', async () => {
    const { ledger, db } = await setupLedger();
    await ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    const e2 = await ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    const tampered = { ...e2, payload: { ...e2.payload, latitude: 17 } };
    await db.execute('UPDATE ledger_events SET envelope_json = ? WHERE event_id = ?', [
      JSON.stringify(tampered),
      e2.eventId,
    ]);
    const v = await ledger.verifyLocal();
    expect(v.ok).toBe(false);
    expect(v.issues[0]!.code).toBe('HASH_MISMATCH');
  });
});
