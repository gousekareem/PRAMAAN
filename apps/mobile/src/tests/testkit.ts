import Database from 'better-sqlite3';
import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { SqlDatabase, SqlExecutor, SqlValue } from '../storage/db';
import { runLocalMigrations } from '../storage/migrations';
import { LedgerService } from '../ledger/ledger';
import type { ClockSampleNow, DeviceClock, DeviceSigner, RandomSource } from '../types/platform';

/**
 * Test-only adapter running the SAME local migrations on plain SQLite (better-sqlite3).
 * Encryption is provided by SQLCipher on Android and is NOT exercised here.
 */
export function memoryDb(file = ':memory:'): SqlDatabase & { raw: Database.Database } {
  const raw = new Database(file);
  raw.pragma('foreign_keys = ON');
  const exec: SqlExecutor = {
    async execute(sql: string, params: SqlValue[] = []) {
      const st = raw.prepare(sql);
      if (st.reader)
        return { rows: st.all(...params) as Record<string, SqlValue>[], rowsAffected: 0 };
      const r = st.run(...params);
      return { rows: [], rowsAffected: r.changes };
    },
  };
  let depth = 0;
  return {
    raw,
    execute: exec.execute,
    async transaction(fn) {
      const sp = `sp${depth++}`;
      raw.exec(depth === 1 ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${sp}`);
      try {
        const r = await fn(exec);
        raw.exec(depth === 1 ? 'COMMIT' : `RELEASE ${sp}`);
        return r;
      } catch (e) {
        raw.exec(depth === 1 ? 'ROLLBACK' : `ROLLBACK TO ${sp}`);
        throw e;
      } finally {
        depth--;
      }
    },
    async close() {
      raw.close();
    },
  };
}

export class FakeClock implements DeviceClock {
  wall = Date.parse('2026-10-01T08:00:00.000Z');
  mono = 10_000_000;
  bootId = 'boot-A';
  async now(): Promise<ClockSampleNow> {
    return {
      wallTime: new Date(this.wall).toISOString(),
      monotonicMs: this.mono,
      bootId: this.bootId,
    };
  }
  advance(ms: number) {
    this.wall += ms;
    this.mono += ms;
  }
}

export const nodeRandom: RandomSource = { bytes: (n) => new Uint8Array(randomBytes(n)) };

export function nodeSigner() {
  const kp = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const signer: DeviceSigner = {
    sign: async (m) => sign('sha256', Buffer.from(m, 'utf8'), kp.privateKey).toString('base64'),
  };
  return { signer, publicKey: kp.publicKey };
}

export const DEVICE = '7d1f0f0e-2b7a-4c1e-9a55-3b0f6c1d2e01';
export const OFFICER = '1a2b3c4d-1111-4aaa-8bbb-000000000001';
export const DUTY = '9e8d7c6b-2222-4ccc-9ddd-000000000002';

export async function setupLedger(file?: string) {
  const db = memoryDb(file);
  await runLocalMigrations(db);
  const clock = new FakeClock();
  const { signer, publicKey } = nodeSigner();
  const ledger = new LedgerService(db, clock, signer, nodeRandom);
  await ledger.initialise(DEVICE, OFFICER);
  await db.execute(
    "INSERT INTO duty_sessions (id, officer_id, planned_start, planned_end, status, updated_at) VALUES (?, ?, ?, ?, 'ACTIVE', ?)",
    [DUTY, OFFICER, '2026-10-01T07:00:00.000Z', '2026-10-01T19:00:00.000Z', 'x'],
  );
  return { db, clock, ledger, signer, publicKey };
}

export function sha256(b: Buffer) {
  return createHash('sha256').update(b).digest('hex');
}
