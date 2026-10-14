import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Creates a fresh PostgreSQL/PostGIS test database. Requires a reachable server:
 *   TEST_DATABASE_ADMIN_URL (default postgres://pramaan:pramaan_dev_only@localhost:5432/postgres)
 * Docker: `docker compose up -d db` from the repository root. Values from ../../.env are loaded if present.
 */
export default async function setup() {
  try {
    process.loadEnvFile(fileURLToPath(new URL('../../../../.env', import.meta.url)));
  } catch {
    /* .env is optional */
  }
  const adminUrl =
    process.env.TEST_DATABASE_ADMIN_URL ??
    'postgres://pramaan:pramaan_dev_only@localhost:5432/postgres';
  const dbName = process.env.TEST_DATABASE_NAME ?? 'pramaan_test';
  const c = new pg.Client({ connectionString: adminUrl });
  await c.connect();
  await c.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await c.query(`CREATE DATABASE ${dbName}`);
  await c.end();
  const u = new URL(adminUrl);
  u.pathname = `/${dbName}`;
  process.env.TEST_DATABASE_URL = u.toString();
}
