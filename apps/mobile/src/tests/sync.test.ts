import { describe, expect, it } from 'vitest';
import { SyncEngine, MAX_BATCH } from '../sync/syncEngine';
import { backoffDelay } from '../sync/backoff';
import { NetworkError, type HttpClient, type HttpRequest, type HttpResponse } from '../sync/http';
import { DEVICE, DUTY, FakeClock, nodeRandom, setupLedger } from './testkit';

const loc = () => ({
  latitude: 16.3004,
  longitude: 80.4505,
  horizontalAccuracyM: 6,
  speedMps: 0,
  speedAccuracyMps: 0.5,
  provider: 'gps',
  fixDeviceTime: '2026-10-01T08:00:00.000Z',
  mockIndicator: false,
  mockIndicatorSource: null,
});

/** Fake server that accepts everything (idempotently) and records requests. */
class FakeServer implements HttpClient {
  requests: HttpRequest[] = [];
  seen = new Set<string>();
  batches = new Map<string, HttpResponse>();
  mode:
    | 'ok'
    | 'offline'
    | 'timeout'
    | 'captive'
    | '500'
    | '401'
    | 'partial'
    | 'reject-first'
    | '409' = 'ok';
  uploads: Record<string, number> = {};
  uploadMode: 'ok' | 'mismatch' | 'network' = 'ok';
  async send(req: HttpRequest): Promise<HttpResponse> {
    this.requests.push(JSON.parse(JSON.stringify(req)));
    if (this.mode === 'offline') throw new NetworkError('UNREACHABLE', 'no route');
    if (this.mode === 'timeout') throw new NetworkError('TIMEOUT', 'timed out');
    if (this.mode === 'captive') throw new NetworkError('CAPTIVE_PORTAL', 'html');
    if (this.mode === '500') return { status: 500, json: { error: { code: 'INTERNAL_ERROR' } } };
    if (this.mode === '401') return { status: 401, json: { error: { code: 'TOKEN_EXPIRED' } } };
    if (req.method === 'PUT') {
      const id = req.path.split('/').pop()!;
      this.uploads[id] = (this.uploads[id] ?? 0) + 1;
      if (this.uploadMode === 'network') throw new NetworkError('TIMEOUT', 'upload interrupted');
      if (this.uploadMode === 'mismatch')
        return { status: 422, json: { error: { code: 'EVIDENCE_HASH_MISMATCH' } } };
      return { status: 200, json: { status: 'VERIFIED' } };
    }
    const b = req.json as {
      batchId: string;
      events: { eventId: string; deviceSequenceNumber: number; eventHash: string }[];
    };
    if (this.mode === '409') {
      this.mode = 'ok';
      return { status: 409, json: { error: { code: 'IDEMPOTENCY_KEY_REUSED' } } };
    }
    if (this.batches.has(b.batchId)) return this.batches.get(b.batchId)!;
    let events = b.events;
    if (this.mode === 'partial') events = events.slice(0, 1); // server "forgets" to answer some
    const results = events.map((e, i) => {
      if (this.mode === 'reject-first' && i === 0)
        return {
          eventId: e.eventId,
          sequence: e.deviceSequenceNumber,
          status: 'REJECTED',
          code: 'INVALID_SIGNATURE',
          retryable: false,
        };
      const dup = this.seen.has(e.eventId);
      this.seen.add(e.eventId);
      return {
        eventId: e.eventId,
        sequence: e.deviceSequenceNumber,
        status: dup ? 'DUPLICATE' : 'ACCEPTED',
        retryable: false,
      };
    });
    const last = b.events[b.events.length - 1]!;
    const res = {
      status: 200,
      json: {
        batchId: b.batchId,
        replayed: false,
        serverReceivedAt: '2026-10-01T16:00:05.000Z',
        serverTime: '2026-10-01T16:00:05.000Z',
        results,
        chainHead: { sequence: last.deviceSequenceNumber, eventHash: last.eventHash },
      },
    };
    this.batches.set(b.batchId, res);
    return res;
  }
}

const files = { openForUpload: async (p: string) => `${p}.tmp`, deleteTemp: async () => undefined };

async function make() {
  const k = await setupLedger();
  const server = new FakeServer();
  let token: string | null = 'access';
  let refreshOk = true;
  const auth = {
    accessToken: () => token,
    refresh: async () => {
      if (refreshOk) {
        token = 'access2';
        return true;
      }
      token = null;
      return false;
    },
  };
  let now = Date.parse('2026-10-01T16:00:00Z');
  const engine = new SyncEngine(
    k.db,
    k.ledger,
    server,
    auth,
    files,
    k.clock,
    nodeRandom,
    { baseMs: 1000, maxMs: 60_000 },
    () => now,
  );
  return {
    ...k,
    server,
    engine,
    setRefresh: (v: boolean) => (refreshOk = v),
    setToken: (t: string | null) => (token = t),
    tick: (ms: number) => (now += ms),
  };
}

const states = async (db: Awaited<ReturnType<typeof make>>['db']) =>
  (await db.execute('SELECT state FROM sync_outbox ORDER BY device_sequence_number')).rows.map(
    (r) => r.state,
  );

describe('offline-first sync engine', () => {
  it('keeps recording offline and syncs the whole queue when connectivity returns', async () => {
    const t = await make();
    for (let i = 0; i < 120; i++) {
      t.clock.advance(4 * 60_000);
      await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    }
    const off = await t.engine.runOnce({ online: false, deviceId: DEVICE });
    expect(off.status).toBe('OFFLINE');
    expect(off.pendingEvents).toBe(120);
    expect(t.server.requests).toHaveLength(0);
    const on = await t.engine.runOnce({ online: true, deviceId: DEVICE });
    expect(on.status).toBe('SYNCED');
    expect(on.pendingEvents).toBe(0);
    expect(
      t.server.requests.every((r) => (r.json as { events: unknown[] }).events.length <= MAX_BATCH),
    ).toBe(true);
    expect(t.server.requests).toHaveLength(3);
    expect(on.serverChainHead?.sequence).toBe(120);
    // a time anchor was recorded from the server response
    expect((await t.ledger.latestAnchor())?.serverTime).toBe('2026-10-01T16:00:05.000Z');
  });

  it('never deletes events after a successful upload (they are marked ACKNOWLEDGED)', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    await t.engine.runOnce({ online: true, deviceId: DEVICE });
    expect((await t.db.execute('SELECT count(*) n FROM ledger_events')).rows[0]!.n).toBe(1);
    expect(await states(t.db)).toEqual(['ACKNOWLEDGED']);
  });

  it('retries a failed batch with the SAME batch id (idempotent replay) and bounded backoff', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    t.server.mode = 'timeout';
    const r1 = await t.engine.runOnce({ online: true, deviceId: DEVICE });
    expect(r1.status).toBe('FAILED');
    expect(r1.lastError).toMatch(/TIMEOUT/);
    expect(await states(t.db)).toEqual(['ASSIGNED', 'ASSIGNED']);
    // Before the backoff elapses nothing is sent.
    t.server.mode = 'ok';
    await t.engine.runOnce({ online: true, deviceId: DEVICE });
    expect(t.server.requests).toHaveLength(1);
    t.tick(10_000);
    // New events recorded meanwhile are NOT mixed into the replayed batch.
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    await t.engine.runOnce({ online: true, deviceId: DEVICE });
    const ids = t.server.requests.map((r) => (r.json as { batchId: string }).batchId);
    expect(ids[1]).toBe(ids[0]);
    expect((t.server.requests[1]!.json as { events: unknown[] }).events).toHaveLength(2);
    expect(await states(t.db)).toEqual(['ACKNOWLEDGED', 'ACKNOWLEDGED', 'ACKNOWLEDGED']);
  });

  it('treats captive portals, DNS failures and 5xx as failures, not success', async () => {
    for (const mode of ['captive', 'offline', '500'] as const) {
      const t = await make();
      await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
      t.server.mode = mode;
      expect((await t.engine.runOnce({ online: true, deviceId: DEVICE })).status).toBe('FAILED');
      expect(await states(t.db)).toEqual(['ASSIGNED']);
    }
  });

  it('marks only server-confirmed events; unanswered events return to the queue', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    t.server.mode = 'partial';
    await t.engine.runOnce({ online: true, deviceId: DEVICE, maxBatches: 1 });
    expect(await states(t.db)).toEqual(['ACKNOWLEDGED', 'PENDING']);
  });

  it('keeps server-rejected events locally with the reason (never silently dropped)', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    t.server.mode = 'reject-first';
    const s = await t.engine.runOnce({ online: true, deviceId: DEVICE });
    expect(s.rejectedEvents).toBe(1);
    expect(await states(t.db)).toEqual(['REJECTED', 'ACKNOWLEDGED']);
    expect((await t.db.execute('SELECT code FROM conflict_records')).rows[0]!.code).toBe(
      'INVALID_SIGNATURE',
    );
  });

  it('refreshes an expired session once, then reports AUTH_REQUIRED', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    t.server.mode = '401';
    t.setRefresh(false);
    expect((await t.engine.runOnce({ online: true, deviceId: DEVICE })).status).toBe(
      'AUTH_REQUIRED',
    );
    expect(await states(t.db)).toEqual(['ASSIGNED']);
  });

  it('re-batches under a new id after an idempotency-key collision (409)', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    t.server.mode = '409';
    await t.engine.runOnce({ online: true, deviceId: DEVICE });
    const ids = t.server.requests.map((r) => (r.json as { batchId: string }).batchId);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(await states(t.db)).toEqual(['ACKNOWLEDGED']);
  });

  it('survives app termination mid-sync: rows stay ASSIGNED and are replayed by a new engine', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), { dutySessionId: DUTY });
    t.server.mode = 'timeout';
    await t.engine.runOnce({ online: true, deviceId: DEVICE });
    // "restart": new engine instance over the same database
    t.server.mode = 'ok';
    const engine2 = new SyncEngine(
      t.db,
      t.ledger,
      t.server,
      { accessToken: () => 'a', refresh: async () => true },
      files,
      new FakeClock(),
      nodeRandom,
      { baseMs: 1, maxMs: 2 },
      () => Date.parse('2026-10-02T00:00:00Z'),
    );
    await engine2.runOnce({ online: true, deviceId: DEVICE });
    expect(await states(t.db)).toEqual(['ACKNOWLEDGED']);
  });

  it('uploads evidence only after its event is acknowledged and recovers interrupted uploads', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), {
      dutySessionId: DUTY,
      alsoInTx: async (tx, ev) => {
        await tx.execute(
          "INSERT INTO evidence_manifests (evidence_id, event_id, sealed_path, image_sha256, manifest_sha256, manifest_json, byte_length, upload_state, created_at) VALUES ('ev1', ?, '/data/ev1.enc', ?, ?, '{}', 10, 'WAITING_FOR_EVENT_ACK', 'x')",
          [ev.eventId, 'a'.repeat(64), 'b'.repeat(64)],
        );
      },
    });
    t.server.uploadMode = 'network';
    const s1 = await t.engine.runOnce({ online: true, deviceId: DEVICE });
    expect(s1.status).toBe('FAILED');
    expect(
      (await t.db.execute('SELECT upload_state FROM evidence_manifests')).rows[0]!.upload_state,
    ).toBe('PENDING');
    // simulate a crash while UPLOADING
    await t.db.execute("UPDATE evidence_manifests SET upload_state = 'UPLOADING'");
    await t.engine.recoverInterrupted();
    t.server.uploadMode = 'ok';
    t.tick(120_000);
    await t.engine.runOnce({ online: true, deviceId: DEVICE });
    expect(
      (await t.db.execute('SELECT upload_state, local_file_deleted FROM evidence_manifests'))
        .rows[0],
    ).toEqual({ upload_state: 'VERIFIED', local_file_deleted: 0 });
    expect(t.server.uploads.ev1).toBe(2);
  });

  it('keeps the original when the server reports a hash mismatch', async () => {
    const t = await make();
    await t.ledger.append('LOCATION_OBSERVED', loc(), {
      dutySessionId: DUTY,
      alsoInTx: async (tx, ev) => {
        await tx.execute(
          "INSERT INTO evidence_manifests (evidence_id, event_id, sealed_path, image_sha256, manifest_sha256, manifest_json, byte_length, upload_state, created_at) VALUES ('ev2', ?, '/data/ev2.enc', ?, ?, '{}', 10, 'WAITING_FOR_EVENT_ACK', 'x')",
          [ev.eventId, 'a'.repeat(64), 'b'.repeat(64)],
        );
      },
    });
    t.server.uploadMode = 'mismatch';
    for (let i = 0; i < 3; i++) {
      await t.engine.runOnce({ online: true, deviceId: DEVICE });
      t.tick(3_600_000);
    }
    const r = (await t.db.execute('SELECT upload_state, sealed_path FROM evidence_manifests'))
      .rows[0]!;
    expect(r.upload_state).toBe('QUARANTINED_BY_SERVER');
    expect(r.sealed_path).toBe('/data/ev2.enc');
  });

  it('backoff grows exponentially, is jittered and bounded', () => {
    const p = { baseMs: 1000, maxMs: 60_000 };
    expect(backoffDelay(0, () => 0, p)).toBe(500);
    expect(backoffDelay(3, () => 1, p)).toBe(8000);
    expect(backoffDelay(50, () => 1, p)).toBe(60_000);
    expect(backoffDelay(50, () => 0, p)).toBe(30_000);
  });
});
