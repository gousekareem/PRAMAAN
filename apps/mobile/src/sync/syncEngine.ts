import { all, one, type SqlDatabase } from '../storage/db';
import { Mutex, uuidV4, type DeviceClock, type RandomSource } from '../types/platform';
import type { LedgerService } from '../ledger/ledger';
import { backoffDelay, DEFAULT_BACKOFF, type BackoffPolicy } from './backoff';
import { NetworkError, type HttpClient } from './http';

export const MAX_BATCH = 50;

export type SyncStatus = 'OFFLINE' | 'PENDING' | 'SYNCING' | 'SYNCED' | 'FAILED' | 'AUTH_REQUIRED';

export interface SyncSnapshot {
  status: SyncStatus;
  pendingEvents: number;
  pendingEvidence: number;
  rejectedEvents: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  serverChainHead: { sequence: number; eventHash: string } | null;
}

export interface AuthSession {
  accessToken(): string | null;
  /** Returns true if a new access token was obtained. */
  refresh(): Promise<boolean>;
}

export interface EvidenceFileAccess {
  /** Decrypts the sealed file to a temporary path after re-checking its SHA-256. */
  openForUpload(sealedPath: string, expectedSha256: string): Promise<string>;
  deleteTemp(path: string): Promise<void>;
}

interface BatchResponse {
  batchId: string;
  serverReceivedAt: string;
  serverTime: string;
  results: {
    eventId: string | null;
    status: 'ACCEPTED' | 'DUPLICATE' | 'REJECTED' | 'CONFLICT';
    code?: string;
    detail?: string;
  }[];
  chainHead: { sequence: number; eventHash: string } | null;
}

function isBatchResponse(v: unknown, batchId: string): v is BatchResponse {
  const b = v as BatchResponse;
  return (
    !!b &&
    b.batchId === batchId &&
    Array.isArray(b.results) &&
    typeof b.serverReceivedAt === 'string'
  );
}

/**
 * Store-and-forward synchroniser.
 * - Only events explicitly confirmed (ACCEPTED or DUPLICATE) by the server are marked acknowledged.
 * - A batch keeps its batchId until it is answered, so a retry after a crash or timeout is an
 *   exact replay that the server de-duplicates.
 * - Nothing is ever deleted because a request "succeeded"; compaction is a separate,
 *   retention-driven step (see retention.ts).
 */
export class SyncEngine {
  private readonly mutex = new Mutex();
  private running = false;
  constructor(
    private readonly db: SqlDatabase,
    private readonly ledger: LedgerService,
    private readonly http: HttpClient,
    private readonly auth: AuthSession,
    private readonly files: EvidenceFileAccess,
    private readonly clock: DeviceClock,
    private readonly random: RandomSource,
    private readonly backoff: BackoffPolicy = DEFAULT_BACKOFF,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  /** Recovery after process death: uploads that were in flight are retried from scratch. */
  async recoverInterrupted(): Promise<void> {
    await this.db.execute(
      "UPDATE evidence_manifests SET upload_state = 'PENDING' WHERE upload_state = 'UPLOADING'",
    );
  }

  private async setCursor(name: string, value: unknown) {
    await this.db.execute(
      'INSERT INTO sync_cursors (name, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at',
      [name, JSON.stringify(value), new Date(this.nowMs()).toISOString()],
    );
  }

  private async cursor<T>(name: string): Promise<T | null> {
    const r = await one(this.db, 'SELECT value_json FROM sync_cursors WHERE name = ?', [name]);
    return r ? (JSON.parse(String(r.value_json)) as T) : null;
  }

  async snapshot(online = true): Promise<SyncSnapshot> {
    const c = await one(
      this.db,
      `SELECT
        (SELECT count(*) FROM sync_outbox WHERE state IN ('PENDING','ASSIGNED')) AS pe,
        (SELECT count(*) FROM sync_outbox WHERE state = 'REJECTED') AS rj,
        (SELECT count(*) FROM evidence_manifests WHERE upload_state IN ('WAITING_FOR_EVENT_ACK','PENDING','UPLOADING')) AS pv`,
    );
    const status = (await this.cursor<SyncStatus>('status')) ?? 'PENDING';
    const pendingEvents = Number(c?.pe ?? 0);
    const pendingEvidence = Number(c?.pv ?? 0);
    let effective: SyncStatus = status;
    if (this.running) effective = 'SYNCING';
    else if (!online) effective = 'OFFLINE';
    else if (status === 'SYNCED' && (pendingEvents || pendingEvidence)) effective = 'PENDING';
    return {
      status: effective,
      pendingEvents,
      pendingEvidence,
      rejectedEvents: Number(c?.rj ?? 0),
      lastSuccessAt: await this.cursor<string>('last_success_at'),
      lastError: await this.cursor<string>('last_error'),
      serverChainHead: await this.cursor('server_chain_head'),
    };
  }

  async runOnce(opts: {
    online: boolean;
    deviceId: string;
    maxBatches?: number;
  }): Promise<SyncSnapshot> {
    if (!opts.online) {
      await this.setCursor('status', 'OFFLINE');
      return this.snapshot(false);
    }
    return this.mutex.run(async () => {
      this.running = true;
      try {
        let outcome: SyncStatus = 'SYNCED';
        for (let i = 0; i < (opts.maxBatches ?? 5); i++) {
          const r = await this.syncOneBatch(opts.deviceId);
          if (r === 'NOTHING') break;
          if (r !== 'OK') {
            outcome = r;
            break;
          }
        }
        if (outcome === 'SYNCED') {
          const u = await this.uploadEvidence();
          if (u !== 'OK') outcome = u;
        }
        await this.setCursor('status', outcome);
        if (outcome === 'SYNCED') {
          await this.setCursor('last_success_at', new Date(this.nowMs()).toISOString());
          await this.setCursor('last_error', null);
        }
      } finally {
        this.running = false;
      }
      return this.snapshot(true);
    });
  }

  private async failRows(batchId: string, error: string) {
    const rows = await all(
      this.db,
      'SELECT event_id, attempts FROM sync_outbox WHERE batch_id = ?',
      [batchId],
    );
    const attempts = Math.max(0, ...rows.map((r) => Number(r.attempts))) + 1;
    const next =
      this.nowMs() + backoffDelay(attempts, () => this.random.bytes(1)[0]! / 255, this.backoff);
    await this.db.execute(
      'UPDATE sync_outbox SET attempts = ?, next_attempt_at = ?, last_error = ? WHERE batch_id = ?',
      [attempts, next, error.slice(0, 300), batchId],
    );
    await this.setCursor('last_error', error);
  }

  private async syncOneBatch(
    deviceId: string,
    authRetried = false,
  ): Promise<'OK' | 'NOTHING' | SyncStatus> {
    const now = this.nowMs();
    // 1. Resume an unanswered batch with its original id, or assign a new bounded batch.
    let batchId = (
      await one(
        this.db,
        "SELECT batch_id FROM sync_outbox WHERE state = 'ASSIGNED' ORDER BY device_sequence_number LIMIT 1",
      )
    )?.batch_id as string | undefined;
    if (batchId) {
      const due = await one(
        this.db,
        'SELECT min(next_attempt_at) AS n FROM sync_outbox WHERE batch_id = ?',
        [batchId],
      );
      if (Number(due?.n ?? 0) > now) return 'NOTHING';
    } else {
      const pending = await all(
        this.db,
        "SELECT event_id FROM sync_outbox WHERE state = 'PENDING' AND next_attempt_at <= ? ORDER BY device_sequence_number LIMIT ?",
        [now, MAX_BATCH],
      );
      if (!pending.length) return 'NOTHING';
      batchId = uuidV4(this.random);
      const id = batchId;
      await this.db.transaction(async (tx) => {
        for (const p of pending)
          await tx.execute(
            "UPDATE sync_outbox SET state = 'ASSIGNED', batch_id = ? WHERE event_id = ? AND state = 'PENDING'",
            [id, String(p.event_id)],
          );
      });
    }
    const rows = await all(
      this.db,
      `SELECT l.envelope_json, l.event_id FROM sync_outbox o JOIN ledger_events l ON l.event_id = o.event_id
                                      WHERE o.batch_id = ? ORDER BY o.device_sequence_number`,
      [batchId],
    );
    const events = rows.map((r) => JSON.parse(String(r.envelope_json)));
    const token = this.auth.accessToken();
    if (!token) {
      await this.setCursor('last_error', 'Not signed in');
      return 'AUTH_REQUIRED';
    }
    const t0 = await this.clock.now();
    let res;
    try {
      res = await this.http.send({
        method: 'POST',
        path: '/api/v1/sync/batch',
        token,
        json: { batchId, schemaVersion: 1, deviceId, events },
        timeoutMs: 45_000,
      });
    } catch (e) {
      const msg =
        e instanceof NetworkError ? `${e.kind}: ${e.message}` : `UNKNOWN: ${(e as Error).message}`;
      await this.failRows(batchId, msg);
      return 'FAILED';
    }
    const t1 = await this.clock.now();
    if (res.status === 401) {
      if (!authRetried && (await this.auth.refresh())) return this.syncOneBatch(deviceId, true);
      await this.setCursor('last_error', 'Session expired; sign in again');
      return 'AUTH_REQUIRED';
    }
    if (res.status === 409) {
      // Idempotency key collision: release rows so they are re-batched under a fresh id.
      await this.db.execute(
        "UPDATE sync_outbox SET state = 'PENDING', batch_id = NULL WHERE batch_id = ?",
        [batchId],
      );
      await this.setCursor('last_error', 'Batch id reused; re-batching');
      return 'OK';
    }
    if (res.status !== 200 || !isBatchResponse(res.json, batchId)) {
      const code =
        (res.json as { error?: { code?: string } } | null)?.error?.code ?? `HTTP_${res.status}`;
      await this.failRows(batchId, `${code} (HTTP ${res.status})`);
      if (res.status === 400 || res.status === 413 || res.status === 422) {
        await this.db.execute(
          'INSERT INTO conflict_records (id, event_id, code, detail, recorded_at) VALUES (?, NULL, ?, ?, ?)',
          [
            uuidV4(this.random),
            code,
            `Batch ${batchId} rejected as a whole`,
            new Date(now).toISOString(),
          ],
        );
      }
      return 'FAILED';
    }
    const body = res.json;
    const inBatch = new Set(rows.map((r) => String(r.event_id)));
    await this.db.transaction(async (tx) => {
      for (const r of body.results) {
        if (!r.eventId || !inBatch.has(r.eventId)) continue;
        inBatch.delete(r.eventId);
        if (r.status === 'ACCEPTED' || r.status === 'DUPLICATE') {
          await tx.execute(
            "UPDATE sync_outbox SET state = 'ACKNOWLEDGED', acknowledged_at = ?, last_error = NULL WHERE event_id = ?",
            [body.serverReceivedAt, r.eventId],
          );
          await tx.execute(
            'UPDATE ledger_events SET server_received_at = COALESCE(server_received_at, ?), server_result = ? WHERE event_id = ?',
            [body.serverReceivedAt, r.status, r.eventId],
          );
          await tx.execute(
            "UPDATE evidence_manifests SET upload_state = 'PENDING' WHERE event_id = ? AND upload_state = 'WAITING_FOR_EVENT_ACK'",
            [r.eventId],
          );
        } else {
          // Terminal server decision for this exact content. Kept locally, never retried blindly, never deleted.
          await tx.execute(
            "UPDATE sync_outbox SET state = 'REJECTED', last_error = ? WHERE event_id = ?",
            [`${r.code ?? r.status}: ${r.detail ?? ''}`.slice(0, 300), r.eventId],
          );
          await tx.execute('UPDATE ledger_events SET server_result = ? WHERE event_id = ?', [
            `${r.status}:${r.code ?? ''}`,
            r.eventId,
          ]);
          await tx.execute(
            'INSERT INTO conflict_records (id, event_id, code, detail, recorded_at) VALUES (?, ?, ?, ?, ?)',
            [
              uuidV4(this.random),
              r.eventId,
              r.code ?? r.status,
              r.detail ?? null,
              new Date(now).toISOString(),
            ],
          );
        }
      }
      // Events the server did not mention are NOT acknowledged.
      for (const missing of inBatch)
        await tx.execute(
          "UPDATE sync_outbox SET state = 'PENDING', batch_id = NULL WHERE event_id = ?",
          [missing],
        );
    });
    if (body.chainHead) await this.setCursor('server_chain_head', body.chainHead);
    const midMono = Math.round((t0.monotonicMs + t1.monotonicMs) / 2);
    await this.ledger.recordTimeAnchor(
      body.serverTime,
      midMono,
      t1.bootId,
      t1.wallTime,
      t1.monotonicMs - t0.monotonicMs,
    );
    return 'OK';
  }

  private async uploadEvidence(): Promise<'OK' | SyncStatus> {
    const due = await all(
      this.db,
      "SELECT * FROM evidence_manifests WHERE upload_state = 'PENDING' AND next_attempt_at <= ? ORDER BY created_at LIMIT 3",
      [this.nowMs()],
    );
    for (const ev of due) {
      const id = String(ev.evidence_id);
      const token = this.auth.accessToken();
      if (!token) return 'AUTH_REQUIRED';
      await this.db.execute(
        "UPDATE evidence_manifests SET upload_state = 'UPLOADING', upload_attempts = upload_attempts + 1 WHERE evidence_id = ?",
        [id],
      );
      let temp: string | null = null;
      const attempts = Number(ev.upload_attempts) + 1;
      const retryLater = async (state: 'PENDING' | 'FAILED', err: string) => {
        const next =
          this.nowMs() + backoffDelay(attempts, () => this.random.bytes(1)[0]! / 255, this.backoff);
        await this.db.execute(
          'UPDATE evidence_manifests SET upload_state = ?, next_attempt_at = ?, last_error = ? WHERE evidence_id = ?',
          [state, next, err.slice(0, 300), id],
        );
      };
      try {
        temp = await this.files.openForUpload(String(ev.sealed_path), String(ev.image_sha256));
        const res = await this.http.send({
          method: 'PUT',
          path: `/api/v1/sync/evidence/${id}`,
          token,
          file: { uri: `file://${temp}`, name: `${id}.jpg`, type: 'image/jpeg' },
          timeoutMs: 120_000,
        });
        if (res.status === 200) {
          await this.db.execute(
            "UPDATE evidence_manifests SET upload_state = 'VERIFIED', last_error = NULL WHERE evidence_id = ?",
            [id],
          );
        } else if (res.status === 422) {
          await retryLater(
            attempts >= 3 ? 'FAILED' : 'PENDING',
            'Server hash mismatch (quarantined); original retained locally',
          );
          if (attempts >= 3)
            await this.db.execute(
              "UPDATE evidence_manifests SET upload_state = 'QUARANTINED_BY_SERVER' WHERE evidence_id = ?",
              [id],
            );
        } else if (res.status === 401) {
          await retryLater('PENDING', 'Session expired');
          if (!(await this.auth.refresh())) return 'AUTH_REQUIRED';
        } else if (res.status === 413 || res.status === 429) {
          await retryLater('FAILED', `HTTP ${res.status}; supervisor review required`);
        } else {
          await retryLater('PENDING', `HTTP ${res.status}`);
          return 'FAILED';
        }
      } catch (e) {
        await retryLater(
          'PENDING',
          e instanceof NetworkError ? `${e.kind}: ${e.message}` : String((e as Error).message),
        );
        return 'FAILED';
      } finally {
        if (temp) await this.files.deleteTemp(temp).catch(() => undefined);
      }
    }
    return 'OK';
  }
}
