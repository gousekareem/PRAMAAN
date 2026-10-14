import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';

/**
 * Lightweight, forward-only SQL migration runner (see docs/adr/ADR-005-migrations.md).
 *  - Applies database/migrations/NNNN_name.sql in lexical order.
 *  - Each migration runs in its own transaction; a failure leaves the schema at the last good version.
 *  - Stores a SHA-256 checksum; editing an applied migration is detected and refused.
 *  - A session-level advisory lock prevents two instances migrating concurrently.
 */
export function findMigrationsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MIGRATIONS_DIR,
    resolve(here, '../../../../database/migrations'),
    resolve(here, '../../../database/migrations'),
    resolve(process.cwd(), 'database/migrations'),
    resolve(process.cwd(), '../../database/migrations'),
  ].filter(Boolean) as string[];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('database/migrations directory not found');
  return found;
}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: string[];
}

export async function migrate(pool: pg.Pool, dir = findMigrationsDir()): Promise<MigrationResult> {
  const files = readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort();
  const client = await pool.connect();
  const applied: string[] = [];
  const alreadyApplied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock(727268)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, name text NOT NULL, checksum char(64) NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const done = new Map(rows.map((r) => [r.version, r.checksum]));
    for (const file of files) {
      const sql = readFileSync(join(dir, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const version = file.slice(0, 4);
      const prior = done.get(version);
      if (prior) {
        if (prior !== checksum)
          throw new Error(`Migration ${file} was modified after being applied (checksum mismatch)`);
        alreadyApplied.push(file);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version, name, checksum) VALUES ($1, $2, $3)',
          [version, file, checksum],
        );
        await client.query('COMMIT');
        applied.push(file);
      } catch (e) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727268)').catch(() => undefined);
    client.release();
  }
  return { applied, alreadyApplied };
}
