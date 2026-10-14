import {
  computeEventHash,
  detectClockAnomalies,
  estimateTrustedTime,
  eventSignatureMessage,
  GENESIS_HASH,
  verifyChain,
  type EventBody,
  type EventType,
  type SignedEvent,
  type TimeAnchor,
} from '@pramaan/event-contracts';
import { validatePayload } from '@pramaan/validation';
import { all, one, type SqlDatabase, type SqlExecutor } from '../storage/db';
import {
  Mutex,
  uuidV4,
  type DeviceClock,
  type DeviceSigner,
  type RandomSource,
} from '../types/platform';

export class LedgerError extends Error {}

interface DeviceStateRow {
  device_id: string;
  officer_id: string;
  next_sequence: number;
  head_hash: string;
  last_wall_time: string | null;
  last_monotonic_ms: number | null;
  last_boot_id: string | null;
  registration_status: string;
  [k: string]: string | number | null;
}

export interface AppendOptions {
  dutySessionId?: string | null;
  /** Extra statements executed atomically with the append (e.g. evidence manifest row). */
  alsoInTx?: (tx: SqlExecutor, event: SignedEvent) => Promise<void>;
  /** Internal: suppresses recursive clock-anomaly events. */
  skipClockCheck?: boolean;
}

/**
 * Append-only, hash-linked, device-signed local ledger stored in SQLCipher.
 *
 * Every append is one transaction that: reads the persisted sequence/head, builds the
 * canonical event, hashes it, signs it with the device key, inserts the ledger row and the
 * outbox row, and advances the persisted head. A crash at any point leaves either the old
 * state or the complete new state — sequence numbers never reset or repeat.
 */
export class LedgerService {
  private readonly mutex = new Mutex();
  constructor(
    private readonly db: SqlDatabase,
    private readonly clock: DeviceClock,
    private readonly signer: DeviceSigner,
    private readonly random: RandomSource,
  ) {}

  async initialise(deviceId: string, officerId: string): Promise<void> {
    const existing = await one<DeviceStateRow>(this.db, 'SELECT * FROM device_state WHERE id = 1');
    if (existing) {
      if (existing.device_id !== deviceId || existing.officer_id !== officerId) {
        throw new LedgerError(
          'Ledger belongs to a different device/officer; refusing to mix chains.',
        );
      }
      return;
    }
    await this.db.execute(
      'INSERT INTO device_state (id, device_id, officer_id, next_sequence, head_hash, created_at) VALUES (1, ?, ?, 1, ?, ?)',
      [deviceId, officerId, GENESIS_HASH, new Date().toISOString()],
    );
  }

  async state(): Promise<DeviceStateRow | undefined> {
    return one<DeviceStateRow>(this.db, 'SELECT * FROM device_state WHERE id = 1');
  }

  async latestAnchor(): Promise<TimeAnchor | null> {
    const r = await one(this.db, 'SELECT * FROM time_anchors ORDER BY id DESC LIMIT 1');
    if (!r) return null;
    return {
      serverTime: String(r.server_time),
      monotonicMs: Number(r.monotonic_ms),
      bootId: String(r.boot_id),
      deviceWallTimeAtAnchor: String(r.device_wall_at_anchor),
      roundTripMs: Number(r.round_trip_ms),
    };
  }

  async recordTimeAnchor(
    serverTime: string,
    monotonicAtResponse: number,
    bootId: string,
    deviceWall: string,
    roundTripMs: number,
  ): Promise<void> {
    if (Number.isNaN(Date.parse(serverTime))) return;
    await this.db.execute(
      'INSERT INTO time_anchors (server_time, monotonic_ms, boot_id, device_wall_at_anchor, round_trip_ms, received_at) VALUES (?, ?, ?, ?, ?, ?)',
      [
        serverTime,
        monotonicAtResponse,
        bootId,
        deviceWall,
        Math.max(0, Math.round(roundTripMs)),
        new Date().toISOString(),
      ],
    );
    await this.db.execute(
      'DELETE FROM time_anchors WHERE id NOT IN (SELECT id FROM time_anchors ORDER BY id DESC LIMIT 20)',
    );
  }

  async append(
    eventType: EventType,
    payload: Record<string, unknown>,
    opts: AppendOptions = {},
  ): Promise<SignedEvent> {
    const pv = validatePayload(eventType, payload);
    if (!pv.ok) throw new LedgerError(`Invalid ${eventType} payload: ${pv.issues.join('; ')}`);
    let anomalies: ReturnType<typeof detectClockAnomalies> = [];
    const event = await this.mutex.run(async () => {
      const now = await this.clock.now();
      const anchor = await this.latestAnchor();
      const trusted = estimateTrustedTime(anchor, now.monotonicMs, now.bootId);
      return this.db.transaction(async (tx) => {
        const s = (await tx.execute('SELECT * FROM device_state WHERE id = 1')).rows[0] as
          | DeviceStateRow
          | undefined;
        if (!s) throw new LedgerError('Ledger not initialised');
        if (!opts.skipClockCheck) {
          anomalies = detectClockAnomalies(
            s.last_wall_time && s.last_boot_id !== null
              ? {
                  deviceWallTime: s.last_wall_time,
                  monotonicElapsedMs: Number(s.last_monotonic_ms),
                  bootId: String(s.last_boot_id),
                }
              : null,
            {
              deviceWallTime: now.wallTime,
              monotonicElapsedMs: now.monotonicMs,
              bootId: now.bootId,
            },
            trusted,
          );
        }
        const body: EventBody = {
          schemaVersion: 1,
          eventId: uuidV4(this.random),
          eventType,
          officerId: s.officer_id,
          dutySessionId: opts.dutySessionId ?? null,
          deviceId: s.device_id,
          deviceSequenceNumber: Number(s.next_sequence),
          deviceWallTime: now.wallTime,
          monotonicElapsedMs: now.monotonicMs,
          bootId: now.bootId,
          trustedTimeEstimate: trusted.estimate,
          trustedTimeUncertaintyMs: trusted.uncertaintyMs,
          trustedTimeSource: trusted.source,
          payload,
          previousEventHash: s.head_hash,
        };
        const eventHash = computeEventHash(body);
        const deviceSignature = await this.signer.sign(eventSignatureMessage(eventHash));
        const signed: SignedEvent = { ...body, eventHash, deviceSignature };
        await tx.execute(
          `INSERT INTO ledger_events (event_id, device_sequence_number, event_type, duty_session_id, envelope_json, event_hash, previous_event_hash,
             device_wall_time, monotonic_ms, boot_id, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
          [
            signed.eventId,
            signed.deviceSequenceNumber,
            eventType,
            signed.dutySessionId,
            JSON.stringify(signed),
            eventHash,
            body.previousEventHash,
            now.wallTime,
            now.monotonicMs,
            now.bootId,
            new Date().toISOString(),
          ],
        );
        await tx.execute(
          "INSERT INTO sync_outbox (event_id, device_sequence_number, state) VALUES (?, ?, 'PENDING')",
          [signed.eventId, signed.deviceSequenceNumber],
        );
        if (opts.alsoInTx) await opts.alsoInTx(tx, signed);
        const upd = await tx.execute(
          'UPDATE device_state SET next_sequence = next_sequence + 1, head_hash = ?, last_wall_time = ?, last_monotonic_ms = ?, last_boot_id = ? WHERE id = 1 AND next_sequence = ? AND head_hash = ?',
          [
            eventHash,
            now.wallTime,
            now.monotonicMs,
            now.bootId,
            body.deviceSequenceNumber,
            body.previousEventHash,
          ],
        );
        if (upd.rowsAffected !== 1)
          throw new LedgerError('Concurrent ledger modification detected');
        return signed;
      });
    });
    const warnings = anomalies.filter(
      (a) => a.severity === 'WARNING' || a.code === 'DEVICE_REBOOTED',
    );
    if (warnings.length) {
      await this.append(
        'CLOCK_ANOMALY_DETECTED',
        {
          anomalies: warnings.map((a) => ({
            code: a.code,
            severity: a.severity,
            detail: a.detail,
            deltaMs: a.deltaMs,
          })),
        },
        { dutySessionId: opts.dutySessionId, skipClockCheck: true },
      );
    }
    return event;
  }

  async recent(limit = 50): Promise<SignedEvent[]> {
    const rows = await all(
      this.db,
      'SELECT envelope_json FROM ledger_events ORDER BY device_sequence_number DESC LIMIT ?',
      [limit],
    );
    return rows.map((r) => JSON.parse(String(r.envelope_json)) as SignedEvent);
  }

  /** Verifies the locally retained chain (compacted prefix is represented by the archive). */
  async verifyLocal() {
    const rows = await all(
      this.db,
      'SELECT envelope_json FROM ledger_events ORDER BY device_sequence_number',
    );
    const events = rows.map((r) => JSON.parse(String(r.envelope_json)) as SignedEvent);
    const archived = await one(
      this.db,
      'SELECT device_sequence_number AS s, event_hash AS h FROM ledger_archive ORDER BY device_sequence_number DESC LIMIT 1',
    );
    const res = verifyChain(events);
    if (
      archived &&
      events[0] &&
      events[0].deviceSequenceNumber === Number(archived.s) + 1 &&
      events[0].previousEventHash !== archived.h
    ) {
      res.ok = false;
      res.issues.push({
        code: 'LINK_MISMATCH',
        sequence: events[0].deviceSequenceNumber,
        detail: 'First retained event does not link to the archived head',
      });
    }
    res.ok = res.issues.filter((i) => i.code !== 'ANCHOR_NOT_COVERED').length === 0;
    return res;
  }
}
