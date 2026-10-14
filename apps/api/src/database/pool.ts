import pg from 'pg';
import type { DatabaseEnv } from '../config/env.js';
import { logger } from '../logger.js';

// Return BIGINT (int8) as JS number: sequences and counts stay well below 2^53.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

export type Db = pg.Pool;
export type DbClient = pg.PoolClient | pg.Pool;

export function createPool(env: DatabaseEnv): pg.Pool {
  const ssl =
    env.DATABASE_SSL_MODE === 'verify-full'
      ? { rejectUnauthorized: true, ...(env.DATABASE_CA_CERT ? { ca: env.DATABASE_CA_CERT } : {}) }
      : undefined;
  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL,
    ssl,
    max: env.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    application_name: 'pramaan-api',
  });
  pool.on('error', (err) => logger.error({ err: err.message }, 'idle database client error'));
  return pool;
}

/** Runs fn inside a transaction. Rolls back on any thrown error. */
export async function withTransaction<T>(
  pool: pg.Pool,
  fn: (c: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
